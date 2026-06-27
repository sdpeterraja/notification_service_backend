const mongoose = require('mongoose');

const canvaConfigSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  clientId: {
    type: String,
    default: ''
  },
  clientSecret: {
    type: String,
    default: ''
  },
  redirectUri: {
    type: String,
    default: 'http://localhost:5173/dashboard/ai-assistant'
  },
  accessToken: {
    type: String,
    default: ''
  },
  refreshToken: {
    type: String,
    default: ''
  },
  tokenExpiresAt: {
    type: Date
  },
  scopes: {
    type: [String],
    default: []
  },
  codeVerifier: {
    type: String,
    default: ''
  },
  state: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CanvaConfig', canvaConfigSchema);
