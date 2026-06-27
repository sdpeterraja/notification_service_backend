// models/Automation.js
const mongoose = require('mongoose');

const automationSchema = new mongoose.Schema({
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
  description: {
    type: String
  },
  status: {
    type: String,
    enum: ['Draft', 'Active'],
    default: 'Draft'
  },
  nodes: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: []
  }
}, {
  timestamps: true
});

// Indexes for fast querying per user
automationSchema.index({ userId: 1, name: 1 });
automationSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Automation', automationSchema);
