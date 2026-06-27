const mongoose = require('mongoose');

const recipientSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, default: "Recipient" },
  phone: { type: String, required: true },
  variables: { type: Map, of: String, default: {} },
  status: { type: String, default: "PENDING" },
  sentAt: String,
  deliveredAt: String,
  readAt: String,
  failureReason: String
}, { _id: false, minimize: false, strict: false });

const whatsAppCampaignSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  id: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  templateId: {
    type: String,
    required: true
  },
  scheduledTime: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['SCHEDULED', 'RUNNING', 'COMPLETED', 'PAUSED', 'FAILED'],
    default: "SCHEDULED"
  },
  totalRecipients: {
    type: Number,
    default: 0
  },
  sentCount: {
    type: Number,
    default: 0
  },
  deliveredCount: {
    type: Number,
    default: 0
  },
  readCount: {
    type: Number,
    default: 0
  },
  failedCount: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: String,
    required: true
  },
  recipients: [recipientSchema]
}, {
  timestamps: true,
  minimize: false,
  strict: false
});

whatsAppCampaignSchema.index({ userId: 1, id: 1 });
whatsAppCampaignSchema.index({ status: 1, scheduledTime: 1 });

module.exports = mongoose.model('WhatsAppCampaign', whatsAppCampaignSchema);
