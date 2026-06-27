const mongoose = require('mongoose');

const whatsAppConfigSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  accessToken: {
    type: String,
    default: ""
  },
  phoneId: {
    type: String,
    default: ""
  },
  wabaId: {
    type: String,
    default: ""
  },
  verifyToken: {
    type: String,
    default: "whatsapp_campaign_verify_token_2026"
  },
  apiVersion: {
    type: String,
    default: "v20.0"
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('WhatsAppConfig', whatsAppConfigSchema);
