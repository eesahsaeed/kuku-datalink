const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    type: {
      type: String,
      sparse: true,
      required: true,
    },

    status: {
      type: String,
      default: 'pending',
    },

    amount: {
      type: Number,
      sparse: true,
      required: true,
    },

    reference: {
      type: String,
      trim: true,
      sparse: true, // ← kept sparse
      // unique + default generation moved to pre-save
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    recipientPhone: {
      type: String,
      trim: true,
    },

    recipientSmartCardNumber: {
      type: String,
      trim: true,
    },

    recipientMeterNumber: {
      type: String,
      trim: true,
    },

    provider_code: {
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

    purchasedBy: {
      fullName: String,
      email: String,
      phone: String,
    },

    fundedBy: {
      fullName: String,
      email: String,
      phone: String,
    },

    pricing: {
      originalPrice: Number,
      gain: Number,
      commission: Number,
      fee: Number,
      package_original_amount: Number,
    },

    failureReason: {
      type: String,
      trim: true,
    },

    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Generate reference if missing → prevents null/undefined duplicate key errors
TransactionSchema.pre('save', function () {
  if (!this.reference) {
    this.reference =
      'TXN-' +
      Date.now() +
      '-' +
      Math.random().toString(36).substr(2, 5).toUpperCase();
  }
});

// Indexes
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ reference: 1 }, { sparse: true, unique: true });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ type: 1 });

TransactionSchema.methods.toPublicJSON = function () {
  return {
    id: this._id,
    type: this.type,
    status: this.status,
    amount: this.amount,
    reference: this.reference,
    description: this.description,
    recipientPhone: this.recipientPhone,
    recipientSmartCardNumber: this.recipientSmartCardNumber,
    recipientMeterNumber: this.recipientMeterNumber,
    provider_code: this.provider_code,
    package_name: this.package_name,
    createdAt: this.createdAt,
  };
};

const Transaction =
  mongoose.models.Transaction ||
  mongoose.model('Transaction', TransactionSchema);

module.exports = Transaction;
