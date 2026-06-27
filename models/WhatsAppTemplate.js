const mongoose = require('mongoose');

const whatsAppTemplateSchema = new mongoose.Schema({
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
  category: {
    type: String,
    enum: ['MARKETING', 'UTILITY', 'AUTHENTICATION'],
    required: true
  },
  language: {
    type: String,
    default: "en_US"
  },
  headerType: {
    type: String,
    enum: ['NONE', 'TEXT', 'IMAGE', 'DOCUMENT'],
    default: 'NONE'
  },
  headerText: String,
  bodyText: {
    type: String,
    required: true
  },
  footerText: String,
  buttons: {
    type: Array,
    default: []
  },
  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'DRAFT'],
    default: 'APPROVED'
  },
  createdAt: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

whatsAppTemplateSchema.index({ userId: 1, id: 1 });
whatsAppTemplateSchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model('WhatsAppTemplate', whatsAppTemplateSchema);
