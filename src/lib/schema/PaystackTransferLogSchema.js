const mongoose = require('mongoose');

const PaystackTransferLogSchema = new mongoose.Schema(
  {
    triggerType: {
      type: String,
      enum: ['manual', 'automatic'],
      default: 'manual',
      index: true,
    },
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    provider: {
      type: String,
      default: 'paystack',
    },
    recipientName: {
      type: String,
      required: true,
      trim: true,
    },
    recipientAccountNumber: {
      type: String,
      required: true,
      trim: true,
    },
    recipientBankCode: {
      type: String,
      required: true,
      trim: true,
    },
    recipientCode: {
      type: String,
      default: '',
      trim: true,
    },
    balanceObserved: {
      type: Number,
      required: true,
      default: 0,
    },
    thresholdAmount: {
      type: Number,
      required: true,
      default: 20000,
    },
    transferAmount: {
      type: Number,
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      default: 'NGN',
      uppercase: true,
      trim: true,
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    transferCode: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed', 'skipped', 'otp'],
      default: 'pending',
      index: true,
    },
    reason: {
      type: String,
      default: '',
      trim: true,
    },
    attemptedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    responsePayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

PaystackTransferLogSchema.index({ attemptedAt: -1 });

module.exports =
  mongoose.models.PaystackTransferLog ||
  mongoose.model('PaystackTransferLog', PaystackTransferLogSchema);
