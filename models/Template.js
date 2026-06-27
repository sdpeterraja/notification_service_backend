// models/Template.js
const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  attachments: [{
    url: String,
    name: String,
    content: String
  }],
  previewImage: {
    type: String
  },
  jsonState: {
    type: String
  },
  category: {
    type: String,
    enum: ['promotional', 'transactional', 'newsletter', 'abandoned', 'welcome'],
    default: 'promotional'
  },
  tags: [{
    type: String,
    trim: true
  }],
  usageCount: {
    type: Number,
    default: 0
  },
  isFavorite: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  version: {
    type: Number,
    default: 1
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

// Indexes for better query performance
templateSchema.index({ userId: 1, category: 1 });
templateSchema.index({ userId: 1, isFavorite: 1 });
templateSchema.index({ userId: 1, tags: 1 });
templateSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Template', templateSchema);