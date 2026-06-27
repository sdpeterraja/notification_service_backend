// models/BrevoConfig.js - Simplified version
const mongoose = require('mongoose');

const brevoConfigSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  apiKey: {
    type: String
  },
  senderEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  senderName: {
    type: String,
    trim: true
  },
  isConnected: {
    type: Boolean,
    default: true
  },
  dailyLimit: {
    type: Number,
    default: 10000
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('BrevoConfig', brevoConfigSchema);