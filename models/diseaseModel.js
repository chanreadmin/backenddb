import mongoose from 'mongoose';

const dataSchema = new mongoose.Schema({
  disease: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  autoantibody: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  autoantigen: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  epitope: {
    type: String,
    required: false,
    trim: true
  },
  uniprotId: {
    type: String,
    required: false,
    trim: true,
    index: true,
    validate: {
      validator: function(v) {
        // Basic UniProt ID validation (6 characters: letter + 5 alphanumeric)
        return !v || /^[A-Z][0-9A-Z]{5}$/.test(v) || v === 'Multiple';
      },
      message: 'Invalid UniProt ID format'
    }
  },
  type: {
    type: String,
    required: false,
    trim: true
  },
  metadata: {
    source: String,
    dateAdded: {
      type: Date,
      default: Date.now
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    verified: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for better search performance
dataSchema.index({ disease: 1, autoantibody: 1 });
dataSchema.index({ autoantigen: 1, uniprotId: 1 });
dataSchema.index({ 
  disease: 'text', 
  autoantibody: 'text', 
  autoantigen: 'text', 
  epitope: 'text' 
});

export default mongoose.model('diseaseData', dataSchema);