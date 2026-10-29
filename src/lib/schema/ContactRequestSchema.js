const mongoose = require('mongoose');
const { Schema } = mongoose;

const ContactRequestSchema = new Schema(
  {
    reference: {
      type: String,
      unique: true,
      index: true,
      default: function () {
        const datePart = new Date()
          .toISOString()
          .slice(0, 10)
          .replace(/-/g, '');
        const randomPart = Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();
        return `CTR-${datePart}-${randomPart}`;
      },
    },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    fullName: { type: String, required: true, trim: true },
    emailAddress: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    phoneNumber: { type: String, trim: true, default: '' },
    companyName: { type: String, trim: true, default: '' },
    service: {
      type: String,
      enum: ['general', 'website', 'mobile', 'desktop', 'mac'],
      default: 'general',
      index: true,
    },
    subject: { type: String, trim: true, default: '' },
    message: { type: String, required: true, trim: true },
    source: {
      type: String,
      enum: ['contact_page', 'web_development', 'support', 'other'],
      default: 'other',
    },
    status: {
      type: String,
      enum: ['new', 'contacted', 'in_progress', 'closed'],
      default: 'new',
      index: true,
    },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

ContactRequestSchema.index({ status: 1, createdAt: -1 });
ContactRequestSchema.index({ emailAddress: 1, createdAt: -1 });

module.exports = mongoose.model('ContactRequest', ContactRequestSchema);
