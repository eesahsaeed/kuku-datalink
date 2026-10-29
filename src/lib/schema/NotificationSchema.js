const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },

    category: {
      type: String,
      enum: ['info', 'alert', 'promo', 'reward', 'transaction', 'system'],
      default: 'info',
    },

    title: {
      type: String,
      required: true,
    },

    message: {
      type: String,
      required: true,
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    actionUrl: {
      type: String,
      default: null,
    },

    groupKey: {
      type: String,
      default: null,
      index: true,
    },

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    isGlobal: {
      type: Boolean,
      default: false,
    },

    priority: {
      type: String,
      enum: ['low', 'normal', 'high'],
      default: 'normal',
    },

    expiresAt: {
      type: Date,
      default: null,
    },

    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  { timestamps: true }
);

NotificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, groupKey: 1, createdAt: -1 });

const Notification =
  mongoose.models.Notification ||
  mongoose.model('Notification', NotificationSchema);

module.exports = Notification;
