const mongoose = require('mongoose');

const WebhookIdempotencySchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    reference: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    providerEventId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    status: {
      type: String,
      enum: ['processing', 'processed', 'failed'],
      default: 'processing',
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    lastError: {
      type: String,
      trim: true,
      default: '',
    },
    lastErrorAt: {
      type: Date,
      default: null,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },
    responseBody: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

WebhookIdempotencySchema.index({ provider: 1, key: 1 }, { unique: true });

module.exports =
  mongoose.models.WebhookIdempotency ||
  mongoose.model('WebhookIdempotency', WebhookIdempotencySchema);
