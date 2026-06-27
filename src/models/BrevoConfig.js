// models/BrevoConfig.js
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
  creditsRemaining: {
    type: Number,
    default: 0
  },
  webhookUrl: {
    type: String
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

// Encrypt API key before saving
brevoConfigSchema.pre('save', async function(next) {
  if (this.isModified('apiKey')) {
    const crypto = require('crypto');
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(this.apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    this.apiKey = `${iv.toString('hex')}:${encrypted}`;
  }
  next();
});

module.exports = mongoose.model('BrevoConfig', brevoConfigSchema);