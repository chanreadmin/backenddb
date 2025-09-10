import mongoose from "mongoose";

const dataSchema = new mongoose.Schema(
  {
    disease: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    autoantibody: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    autoantigen: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    epitope: {
      type: String,
      required: true,
      trim: true,
    },
    uniprotId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    
    },
    type: {
      type: String,
      required: false,
      trim: true,
    },
    additional: {
      type: Map,
      of: String,
      default: {}
    },
    metadata: {
      source: String,
      dateAdded: {
        type: Date,
        default: Date.now,
      },
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
      verified: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound indexes for better search performance
dataSchema.index({ disease: 1, autoantibody: 1 });
dataSchema.index({ autoantigen: 1, uniprotId: 1 });
dataSchema.index({
  disease: "text",
  autoantibody: "text",
  autoantigen: "text",
  epitope: "text",
  type: "text",
});

export default mongoose.model("diseaseData", dataSchema);
