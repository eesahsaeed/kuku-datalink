
const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  packageCode: {
    type: String,
    trim: true,
  },
  planCode: {
    type: String,
    trim: true,
  },
  package_api_code: {
    type: String,
    trim: true,
  },
  package_code: {
    type: String,
    trim: true,
  },
  package_name: {
    type: String,
    trim: true,
  },
  durationGroup: {
    type: String,
    trim: true,
  },
  duration_group: {
    type: String,
    trim: true,
  },
  package_original_amount: {
    type: Number,
    default: 0,
  },
  name: {
    type: String
  },
  network: {
    type: String
  },
  originalPrice: {
    type: Number,
    default: 0,
  },
  sellingPrice: {
    type: Number,
    default: 0,
  },
  charges: {
    type: Number,
    default: 0
  },
  fee: {
    type: Number,
    default: 0
  },
  gain: {
    type: Number,
    default: 0
  },
  commission: {
    type: Number
  },
  markup: {
    type: Number
  },
  source: {
    type: String,
    trim: true,
    lowercase: true,
    default: 'aidapay',
  },
  isNew: {
    type: Boolean,
    default: true
  },
  exclude: {
    type: Boolean,
    default: false
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

PlanSchema.index({ planCode: 1 }, { unique: true, sparse: true });
PlanSchema.index({ source: 1, packageCode: 1 }, { unique: true });

const Plan = mongoose.models.Plan || mongoose.model('Plan', PlanSchema);

module.exports = Plan;
