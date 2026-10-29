const mongoose = require('mongoose');

const walletFundingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
      index: true,
    },
    reference: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    source: {
      type: String,
      default: 'paystack',
      trim: true,
    },
    currency: {
      type: String,
      default: 'NGN',
      uppercase: true,
      trim: true,
    },
    grossAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    feeAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    netAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    customerEmail: {
      type: String,
      trim: true,
      default: '',
    },
    accountNumber: {
      type: String,
      trim: true,
      default: '',
    },
    eventType: {
      type: String,
      default: 'charge.success',
      trim: true,
    },
    rawPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    // Keep existing collection data when renaming model references.
    collection: 'paystackwebhooklogs',
  }
);

walletFundingSchema.index({ user: 1, createdAt: -1 });
walletFundingSchema.index({ reference: 1 }, { unique: true });

const WalletFunding =
  mongoose.models.WalletFunding ||
  mongoose.model('WalletFunding', walletFundingSchema);

module.exports = WalletFunding;
