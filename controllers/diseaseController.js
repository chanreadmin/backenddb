import DiseaseData from '../models/diseaseModel.js';
import { validationResult } from 'express-validator';

// Helper Methods

// Improved query builder that properly combines search and filters
export const buildCombinedQuery = (searchParams) => {
  const { search, field, disease, autoantibody, autoantigen, epitope } = searchParams;
  let searchConditions = [];
  let filterConditions = [];

  // Handle text search
  if (search && search.trim()) {
    const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    
    if (field === 'all') {
      searchConditions.push({
        $or: [
          { disease: searchRegex },
          { autoantibody: searchRegex },
          { autoantigen: searchRegex },
          { epitope: searchRegex },
          { uniprotId: searchRegex }
        ]
      });
    } else if (['disease', 'autoantibody', 'autoantigen', 'epitope', 'uniprotId'].includes(field)) {
      const searchQuery = {};
      searchQuery[field] = searchRegex;
      searchConditions.push(searchQuery);
    }
  }

  // Handle specific field filters
  if (disease && disease.trim()) {
    filterConditions.push({ disease: new RegExp(disease.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  }
  if (autoantibody && autoantibody.trim()) {
    filterConditions.push({ autoantibody: new RegExp(autoantibody.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  }
  if (autoantigen && autoantigen.trim()) {
    filterConditions.push({ autoantigen: new RegExp(autoantigen.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  }
  if (epitope && epitope.trim()) {
    filterConditions.push({ epitope: new RegExp(epitope.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  }

  // Combine search and filter conditions
  const allConditions = [...searchConditions, ...filterConditions];
  
  if (allConditions.length === 0) {
    return {};
  } else if (allConditions.length === 1) {
    return allConditions[0];
  } else {
    return { $and: allConditions };
  }
};

export const getRelatedEntries = async (entry) => {
  try {
    return await DiseaseData.find({
      $or: [
        { disease: entry.disease },
        { autoantigen: entry.autoantigen },
        { uniprotId: entry.uniprotId && entry.uniprotId !== 'Multiple' ? entry.uniprotId : null }
      ].filter(condition => Object.values(condition).some(val => val)),
      _id: { $ne: entry._id }
    }).limit(5).lean();
  } catch (error) {
    console.error('Error fetching related entries:', error);
    return [];
  }
};

export const validateBulkEntries = (entries) => {
  const errors = [];
  
  if (!Array.isArray(entries)) {
    errors.push('Entries must be an array');
    return errors;
  }

  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      errors.push(`Entry ${index + 1}: Invalid entry format`);
      return;
    }

    if (!entry.disease || !entry.disease.toString().trim()) {
      errors.push(`Entry ${index + 1}: Disease is required`);
    }
    if (!entry.autoantibody || !entry.autoantibody.toString().trim()) {
      errors.push(`Entry ${index + 1}: Autoantibody is required`);
    }
    if (!entry.autoantigen || !entry.autoantigen.toString().trim()) {
      errors.push(`Entry ${index + 1}: Autoantigen is required`);
    }
    if (entry.uniprotId && entry.uniprotId !== 'Multiple' && !/^[A-Z][0-9A-Z]{5}$/.test(entry.uniprotId)) {
      errors.push(`Entry ${index + 1}: Invalid UniProt ID format`);
    }
  });
  
  return errors;
};

export const escapeCSV = (str) => {
  if (!str) return '';
  const stringValue = str.toString();
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

export const convertToCSV = (entries) => {
  if (!entries || entries.length === 0) return '';
  
  const headers = ['Disease', 'Autoantibody', 'Autoantigen', 'Epitope', 'UniProt ID', 'Date Added', 'Last Updated', 'Verified'];
  const csvRows = [headers.join(',')];
  
  entries.forEach(entry => {
    const row = [
      escapeCSV(entry.disease || ''),
      escapeCSV(entry.autoantibody || ''),
      escapeCSV(entry.autoantigen || ''),
      escapeCSV(entry.epitope || ''),
      escapeCSV(entry.uniprotId || ''),
      entry.createdAt ? new Date(entry.createdAt).toISOString().split('T')[0] : '',
      entry.metadata?.lastUpdated ? new Date(entry.metadata.lastUpdated).toISOString().split('T')[0] : '',
      entry.metadata?.verified ? 'Yes' : 'No'
    ];
    csvRows.push(row.join(','));
  });
  
  return csvRows.join('\n');
};

export const handleError = (res, error, message) => {
  console.error(`${message}:`, error);
  
  // Handle specific MongoDB errors
  let statusCode = 500;
  let errorMessage = message;

  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorMessage = 'Validation error: ' + Object.values(error.errors).map(e => e.message).join(', ');
  } else if (error.name === 'CastError') {
    statusCode = 400;
    errorMessage = 'Invalid ID format';
  } else if (error.code === 11000) {
    statusCode = 409;
    errorMessage = 'Duplicate entry found';
  }

  res.status(statusCode).json({
    success: false,
    message: errorMessage,
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
};

// Controller Methods

export const getAllEntries = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 10), 100);
    const skip = (page - 1) * limit;
    
    const { search, field, disease, autoantibody, autoantigen, epitope, sortBy = 'disease', sortOrder = 'asc' } = req.query;

    // Build combined query
    const query = buildCombinedQuery({ search, field, disease, autoantibody, autoantigen, epitope });

    // Build sort object with validation
    const validSortFields = ['disease', 'autoantibody', 'autoantigen', 'epitope', 'uniprotId', 'createdAt', 'updatedAt'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'disease';
    const sort = {};
    sort[sortField] = sortOrder === 'desc' ? -1 : 1;

    // Execute query with proper error handling
    const [entries, total] = await Promise.all([
      DiseaseData.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      DiseaseData.countDocuments(query).exec()
    ]);

    res.json({
      success: true,
      data: entries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      appliedFilters: {
        search: search || null,
        field: field || null,
        disease: disease || null,
        autoantibody: autoantibody || null,
        autoantigen: autoantigen || null,
        epitope: epitope || null,
        sortBy: sortField,
        sortOrder
      }
    });
  } catch (error) {
    handleError(res, error, 'Error fetching entries');
  }
};

export const getEntryById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Valid entry ID is required'
      });
    }

    const entry = await DiseaseData.findById(id);
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: 'Entry not found'
      });
    }

    const relatedEntries = await getRelatedEntries(entry);

    res.json({
      success: true,
      data: entry,
      relatedEntries: relatedEntries
    });
  } catch (error) {
    handleError(res, error, 'Error fetching entry');
  }
};

export const createEntry = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    // Check for required fields
    const { disease, autoantibody, autoantigen } = req.body;
    if (!disease || !autoantibody || !autoantigen) {
      return res.status(400).json({
        success: false,
        message: 'Disease, autoantibody, and autoantigen are required'
      });
    }

    const entry = new DiseaseData({
      ...req.body,
      metadata: {
        ...req.body.metadata,
        dateAdded: new Date(),
        lastUpdated: new Date()
      }
    });
    
    await entry.save();

    res.status(201).json({
      success: true,
      message: 'Entry created successfully',
      data: entry
    });
  } catch (error) {
    handleError(res, error, 'Error creating entry');
  }
};

export const updateEntry = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { id } = req.params;
    
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Valid entry ID is required'
      });
    }

    const updateData = {
      ...req.body,
      'metadata.lastUpdated': new Date()
    };

    const entry = await DiseaseData.findByIdAndUpdate(
      id,
      updateData,
      { 
        new: true, 
        runValidators: true,
        context: 'query'
      }
    );

    if (!entry) {
      return res.status(404).json({
        success: false,
        message: 'Entry not found'
      });
    }

    res.json({
      success: true,
      message: 'Entry updated successfully',
      data: entry
    });
  } catch (error) {
    handleError(res, error, 'Error updating entry');
  }
};

export const deleteEntry = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || !id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Valid entry ID is required'
      });
    }

    const entry = await DiseaseData.findByIdAndDelete(id);
    if (!entry) {
      return res.status(404).json({
        success: false,
        message: 'Entry not found'
      });
    }

    res.json({
      success: true,
      message: 'Entry deleted successfully'
    });
  } catch (error) {
    handleError(res, error, 'Error deleting entry');
  }
};

export const searchEntries = async (req, res) => {
  try {
    const { q: searchTerm, field = 'all', limit = 20 } = req.query;
    
    if (!searchTerm || searchTerm.trim().length < 1) {
      return res.status(400).json({
        success: false,
        message: 'Search term is required'
      });
    }

    const query = buildCombinedQuery({ search: searchTerm, field });
    const maxLimit = Math.min(parseInt(limit), 100);

    const entries = await DiseaseData.find(query)
      .limit(maxLimit)
      .sort({ disease: 1, autoantibody: 1 })
      .lean();

    res.json({
      success: true,
      data: entries,
      count: entries.length,
      searchTerm: searchTerm.trim()
    });
  } catch (error) {
    handleError(res, error, 'Error searching entries');
  }
};

export const advancedSearch = async (req, res) => {
  try {
    const { q: searchTerm, limit = 50, includeStats = false } = req.query;
    
    if (!searchTerm || searchTerm.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search term must be at least 2 characters long'
      });
    }

    const searchRegex = new RegExp(searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    
    const pipeline = [
      {
        $match: {
          $or: [
            { disease: searchRegex },
            { autoantibody: searchRegex },
            { autoantigen: searchRegex },
            { epitope: searchRegex },
            { uniprotId: searchRegex }
          ]
        }
      },
      {
        $addFields: {
          relevanceScore: {
            $sum: [
              { $cond: [{ $regexMatch: { input: '$disease', regex: searchRegex } }, 10, 0] },
              { $cond: [{ $regexMatch: { input: '$autoantibody', regex: searchRegex } }, 8, 0] },
              { $cond: [{ $regexMatch: { input: '$autoantigen', regex: searchRegex } }, 6, 0] },
              { $cond: [{ $regexMatch: { input: { $ifNull: ['$epitope', ''] }, regex: searchRegex } }, 4, 0] },
              { $cond: [{ $regexMatch: { input: { $ifNull: ['$uniprotId', ''] }, regex: searchRegex } }, 2, 0] }
            ]
          }
        }
      },
      {
        $sort: { relevanceScore: -1, disease: 1 }
      },
      {
        $limit: Math.min(parseInt(limit), 100)
      }
    ];

    const results = await DiseaseData.aggregate(pipeline);

    let stats = null;
    if (includeStats === 'true') {
      const statsResult = await DiseaseData.aggregate([
        {
          $match: {
            $or: [
              { disease: searchRegex },
              { autoantibody: searchRegex },
              { autoantigen: searchRegex },
              { epitope: searchRegex },
              { uniprotId: searchRegex }
            ]
          }
        },
        {
          $group: {
            _id: null,
            totalMatches: { $sum: 1 },
            uniqueDiseases: { $addToSet: '$disease' },
            uniqueAntibodies: { $addToSet: '$autoantibody' },
            uniqueAntigens: { $addToSet: '$autoantigen' }
          }
        },
        {
          $project: {
            totalMatches: 1,
            uniqueDiseasesCount: { $size: '$uniqueDiseases' },
            uniqueAntibodiesCount: { $size: '$uniqueAntibodies' },
            uniqueAntigensCount: { $size: '$uniqueAntigens' }
          }
        }
      ]);
      
      stats = statsResult[0] || { 
        totalMatches: 0, 
        uniqueDiseasesCount: 0, 
        uniqueAntibodiesCount: 0, 
        uniqueAntigensCount: 0 
      };
    }

    res.json({
      success: true,
      data: results,
      count: results.length,
      searchTerm: searchTerm.trim(),
      stats
    });
  } catch (error) {
    handleError(res, error, 'Error performing advanced search');
  }
};

export const getEntriesByDisease = async (req, res) => {
  try {
    const { disease } = req.params;
    
    if (!disease || !disease.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Disease name is required'
      });
    }

    const entries = await DiseaseData.find({
      disease: new RegExp(disease.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    })
    .sort({ autoantibody: 1, autoantigen: 1 })
    .lean();

    res.json({
      success: true,
      data: entries,
      count: entries.length
    });
  } catch (error) {
    handleError(res, error, 'Error fetching entries by disease');
  }
};

export const getEntriesByUniprotId = async (req, res) => {
  try {
    const { uniprotId } = req.params;
    
    if (!uniprotId || !uniprotId.trim()) {
      return res.status(400).json({
        success: false,
        message: 'UniProt ID is required'
      });
    }

    const entries = await DiseaseData.find({
      uniprotId: uniprotId.toUpperCase().trim()
    })
    .sort({ disease: 1, autoantibody: 1 })
    .lean();

    res.json({
      success: true,
      data: entries,
      count: entries.length
    });
  } catch (error) {
    handleError(res, error, 'Error fetching entries by UniProt ID');
  }
};

export const getUniqueValues = async (req, res) => {
  try {
    const { field } = req.params;
    
    if (!field || !['disease', 'autoantibody', 'autoantigen', 'epitope', 'uniprotId'].includes(field)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid field specified. Must be one of: disease, autoantibody, autoantigen, epitope, uniprotId'
      });
    }

    const values = await DiseaseData.distinct(field);
    const filteredValues = values
      .filter(value => value && value.toString().trim() !== '')
      .map(value => value.toString().trim())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    res.json({
      success: true,
      data: filteredValues,
      count: filteredValues.length
    });
  } catch (error) {
    handleError(res, error, 'Error fetching unique values');
  }
};

export const getFilteredUniqueValues = async (req, res) => {
  try {
    const { field } = req.params;
    const { disease, autoantibody, autoantigen } = req.query;

    if (!field || !['disease', 'autoantibody', 'autoantigen', 'epitope'].includes(field)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid field specified. Must be one of: disease, autoantibody, autoantigen, epitope'
      });
    }

    // Build filter query based on dependencies
    let filterQuery = {};
    
    if (field === 'autoantibody' && disease) {
      filterQuery.disease = new RegExp(disease.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    } else if (field === 'autoantigen') {
      if (disease) {
        filterQuery.disease = new RegExp(disease.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
      if (autoantibody) {
        filterQuery.autoantibody = new RegExp(autoantibody.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
    } else if (field === 'epitope') {
      if (autoantigen) {
        filterQuery.autoantigen = new RegExp(autoantigen.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
      if (disease) {
        filterQuery.disease = new RegExp(disease.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
      if (autoantibody) {
        filterQuery.autoantibody = new RegExp(autoantibody.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
      // Only return epitopes for specific autoantigen/disease combinations
      if (!autoantigen && !disease && !autoantibody) {
        return res.json({
          success: true,
          data: [],
          count: 0
        });
      }
    }

    const values = await DiseaseData.distinct(field, filterQuery);
    const filteredValues = values
      .filter(value => value && value.toString().trim() !== '')
      .map(value => value.toString().trim())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    res.json({
      success: true,
      data: filteredValues,
      count: filteredValues.length,
      appliedFilters: { disease, autoantibody, autoantigen }
    });
  } catch (error) {
    handleError(res, error, 'Error fetching filtered unique values');
  }
};

export const getStatistics = async (req, res) => {
  try {
    const stats = await DiseaseData.aggregate([
      {
        $group: {
          _id: null,
          totalEntries: { $sum: 1 },
          uniqueDiseases: { $addToSet: '$disease' },
          uniqueAntibodies: { $addToSet: '$autoantibody' },
          uniqueAntigens: { $addToSet: '$autoantigen' },
          uniqueUniprotIds: { $addToSet: '$uniprotId' },
          verifiedEntries: { $sum: { $cond: ['$metadata.verified', 1, 0] } }
        }
      },
      {
        $project: {
          totalEntries: 1,
          verifiedEntries: 1,
          uniqueDiseasesCount: { $size: '$uniqueDiseases' },
          uniqueAntibodiesCount: { $size: '$uniqueAntibodies' },
          uniqueAntigensCount: { $size: '$uniqueAntigens' },
          uniqueUniprotIdsCount: { $size: '$uniqueUniprotIds' },
          uniqueDiseases: 1,
          uniqueAntibodies: 1,
          uniqueAntigens: 1
        }
      }
    ]);

    const [diseaseStats, antibodyStats, antigenStats] = await Promise.all([
      DiseaseData.aggregate([
        { $group: { _id: '$disease', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]),
      DiseaseData.aggregate([
        { $group: { _id: '$autoantibody', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]),
      DiseaseData.aggregate([
        { $group: { _id: '$autoantigen', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || {},
        diseaseBreakdown: diseaseStats,
        topAntibodies: antibodyStats,
        topAntigens: antigenStats
      }
    });
  } catch (error) {
    handleError(res, error, 'Error fetching statistics');
  }
};

export const bulkImport = async (req, res) => {
  try {
    const { entries } = req.body;
    
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Entries array is required and cannot be empty'
      });
    }

    if (entries.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Cannot import more than 1000 entries at once'
      });
    }

    const validationErrors = validateBulkEntries(entries);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors in bulk data',
        errors: validationErrors
      });
    }

    // Add metadata to entries
    const entriesWithMetadata = entries.map(entry => ({
      ...entry,
      metadata: {
        dateAdded: new Date(),
        lastUpdated: new Date(),
        verified: entry.metadata?.verified || false,
        source: entry.metadata?.source || 'bulk_import'
      }
    }));

    const results = await DiseaseData.insertMany(entriesWithMetadata, {
      ordered: false // Continue with other inserts even if some fail
    });

    res.json({
      success: true,
      message: `Successfully imported ${results.length} entries`,
      data: {
        inserted: results.length,
        total: entries.length,
        failed: entries.length - results.length
      }
    });
  } catch (error) {
    // Handle partial success in bulk operations
    if (error.result && error.result.insertedCount > 0) {
      return res.status(207).json({
        success: true,
        message: `Partially successful: imported ${error.result.insertedCount} entries`,
        data: {
          inserted: error.result.insertedCount,
          failed: error.writeErrors?.length || 0,
          errors: error.writeErrors?.map(err => err.errmsg) || []
        }
      });
    }
    
    handleError(res, error, 'Error during bulk import');
  }
};

export const exportEntries = async (req, res) => {
  try {
    const { format = 'json', disease, autoantibody, autoantigen, limit } = req.query;
    
    let query = {};
    if (disease) query.disease = new RegExp(disease.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (autoantibody) query.autoantibody = new RegExp(autoantibody.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (autoantigen) query.autoantigen = new RegExp(autoantigen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    let queryBuilder = DiseaseData.find(query).sort({ disease: 1, autoantibody: 1 });
    
    if (limit && parseInt(limit) > 0) {
      queryBuilder = queryBuilder.limit(Math.min(parseInt(limit), 10000));
    }
    
    const entries = await queryBuilder.lean();

    if (format === 'csv') {
      const csv = convertToCSV(entries);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=disease_database.csv');
      return res.send(csv);
    }

    res.json({
      success: true,
      data: entries,
      count: entries.length,
      exportFormat: format,
      appliedFilters: { disease, autoantibody, autoantigen }
    });
  } catch (error) {
    handleError(res, error, 'Error exporting entries');
  }
};