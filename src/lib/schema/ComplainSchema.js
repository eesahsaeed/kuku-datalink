const mongoose = require('mongoose');
const { Schema } = mongoose;

const ConversationEntrySchema = new Schema(
  {
    fromName: { type: String, trim: true },
    fromEmail: { type: String, trim: true, lowercase: true },
    fromType: {
      type: String,
      enum: ['user', 'agent'],
      required: true,
    },
    text: { type: String },
    html: { type: String },
    createdAt: { type: Date, default: Date.now },
    readByUser: { type: Boolean, default: false },
    readByAgent: { type: Boolean, default: false },
    readAtUser: { type: Date }, // optional – when user saw it
    readAtAgent: { type: Date }, // optional – when agent saw it
    emailDigestSentAt: { type: Date },
    emailDigestToken: { type: String, trim: true },
    emailDigestMessageId: { type: String, trim: true },
    mailboxSeenAt: { type: Date },
  },
  { _id: true }
);

const ComplainSchema = new Schema(
  {
    // Main ticket identifier – human-readable / support-facing
    ticket: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: function () {
        // Generates e.g. TKT-20260118-AB1234
        const datePart = new Date()
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, '');
        const randomPart = Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();
        return `TKT-${datePart}-${randomPart}`;
      },
    },

    subject: { type: String, required: true, trim: true },
    senderName: { type: String, trim: true },
    senderEmail: { type: String, required: true, trim: true, lowercase: true },

    conversation: {
      type: [ConversationEntrySchema],
      default: [],
    },
    bodyHtml: { type: String }, // optional legacy/summary
    messageId: { type: String, index: true },
    rootMessageId: { type: String, index: true },
    threadMessageIds: {
      type: [String],
      default: [],
      index: true,
    },
    threadId: { type: String },
    processed: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed, default: {} },
    source: {
      type: String,
      enum: ['email', 'web', 'phone', 'sms', 'other'],
      default: 'email',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: ['open', 'pending', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
  }
);

// Indexes
ComplainSchema.index({ senderEmail: 1, createdAt: -1 });
ComplainSchema.index({ status: 1, priority: -1, createdAt: -1 });
ComplainSchema.index({ ticket: 1 });

// Helper method to append message
ComplainSchema.methods.appendMessage = async function (entry = {}) {
  const allowed = ['user', 'agent'];
  if (!entry || !entry.fromType || !allowed.includes(entry.fromType)) {
    throw new Error('Invalid message fromType — must be "user" or "agent"');
  }

  const message = {
    fromName: entry.fromName || undefined,
    fromEmail: entry.fromEmail || undefined,
    fromType: entry.fromType,
    text: entry.text || undefined,
    html: entry.html || undefined,
    attachments: entry.attachments || [],
    metadata: entry.metadata || {},
    createdAt: entry.createdAt || new Date(),
    readByUser: typeof entry.readByUser === 'boolean' ? entry.readByUser : false,
    readByAgent:
      typeof entry.readByAgent === 'boolean' ? entry.readByAgent : false,
    readAtUser: entry.readAtUser || undefined,
    readAtAgent: entry.readAtAgent || undefined,
  };

  this.conversation = this.conversation || [];
  this.conversation.push(message);
  await this.save();
  return this;
};

module.exports = mongoose.model('Complain', ComplainSchema);
