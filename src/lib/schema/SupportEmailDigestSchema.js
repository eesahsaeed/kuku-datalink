const mongoose = require('mongoose');

const SupportEmailDigestSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Complain',
      required: true,
      index: true,
    },
    recipientEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    conversationEntryIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },
    conversationIndexes: {
      type: [Number],
      default: [],
    },
    mailMessageId: {
      type: String,
      trim: true,
      default: '',
    },
    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    openedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SupportEmailDigest', SupportEmailDigestSchema);
