const mongoose = require('mongoose');

const AuthIdempotencySchema = new mongoose.Schema(
  {
    route: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    requestHash: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['in_progress', 'completed'],
      default: 'in_progress',
      index: true,
    },
    statusCode: {
      type: Number,
      default: null,
    },
    responseBody: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  }
);

AuthIdempotencySchema.index({ route: 1, key: 1 }, { unique: true });

const AuthIdempotency =
  mongoose.models.AuthIdempotency ||
  mongoose.model('AuthIdempotency', AuthIdempotencySchema);

module.exports = AuthIdempotency;
