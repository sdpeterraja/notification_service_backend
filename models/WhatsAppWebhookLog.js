const mongoose = require('mongoose');

const whatsAppWebhookLogSchema = new mongoose.Schema({
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
  timestamp: {
    type: String,
    required: true
  },
  campaignId: String,
  campaignName: String,
  phone: {
    type: String,
    required: true
  },
  status: {
    type: String,
    required: true
  },
  failureReason: String,
  rawPayload: String
}, {
  timestamps: true,
  minimize: false,
  strict: false
});

whatsAppWebhookLogSchema.index({ userId: 1, timestamp: -1 });
whatsAppWebhookLogSchema.index({ phone: 1 });

module.exports = mongoose.model('WhatsAppWebhookLog', whatsAppWebhookLogSchema);
