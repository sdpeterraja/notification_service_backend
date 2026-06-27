// models/Campaign.js
const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
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
  replyTo: {
    type: String,
    trim: true,
    lowercase: true
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'],
    default: 'draft'
  },
  type: {
    type: String,
    enum: ['regular', 'automated', 'ab_test', 'rss', 'personalized'],
    default: 'regular'
  },
  
  // Content
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Template'
  },
  content: {
    type: String
  },
  attachments: [{
    url: String,
    name: String,
    content: String
  }],
  
  // Personalized recipients (for CSV upload and individual personalization)
  recipients: [{
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    name: {
      type: String,
      trim: true
    },
    personalizedSubject: {
      type: String
    },
    personalizedContent: {
      type: String
    },
    customFields: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'failed', 'opened', 'clicked', 'bounced', 'complained'],
      default: 'pending'
    },
    sentAt: Date,
    openedAt: Date,
    clickedAt: Date,
    errorMessage: String
  }],
  
  // Tracking counts for personalized campaigns
  recipientCount: {
    type: Number,
    default: 0
  },
  sentCount: {
    type: Number,
    default: 0
  },
  failedCount: {
    type: Number,
    default: 0
  },
  
  // Targeting
  audienceList: {
    type: String
  },
  segments: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  targetEmails: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  
  // Scheduling
  scheduledFor: {
    type: Date
  },
  sentAt: {
    type: Date
  },
  
  // Statistics
  statistics: {
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
    openCount: {
      type: Number,
      default: 0
    },
    clickCount: {
      type: Number,
      default: 0
    },
    bounceCount: {
      type: Number,
      default: 0
    },
    complaintCount: {
      type: Number,
      default: 0
    },
    uniqueOpens: {
      type: Number,
      default: 0
    },
    uniqueClicks: {
      type: Number,
      default: 0
    },
    openRate: {
      type: Number,
      default: 0
    },
    clickRate: {
      type: Number,
      default: 0
    },
    bounceRate: {
      type: Number,
      default: 0
    }
  },
  
  // A/B Test specific
  abTest: {
    isEnabled: {
      type: Boolean,
      default: false
    },
    variants: [{
      name: String,
      subject: String,
      content: String,
      sentCount: Number,
      openCount: Number,
      clickCount: Number,
      winner: Boolean
    }],
    winnerCriteria: {
      type: String,
      enum: ['open_rate', 'click_rate'],
      default: 'open_rate'
    },
    testPercentage: {
      type: Number,
      default: 20
    }
  },
  
  // Brevo specific
  brevoCampaignId: {
    type: Number
  },
  brevoMessageId: {
    type: String
  },
  
  // Settings
  settings: {
    trackOpens: {
      type: Boolean,
      default: true
    },
    trackClicks: {
      type: Boolean,
      default: true
    },
    trackUnsubscribes: {
      type: Boolean,
      default: true
    },
    addUnsubscribeLink: {
      type: Boolean,
      default: true
    },
    updateExistingContacts: {
      type: Boolean,
      default: true
    }
  },
  
  // Automation specific
  automation: {
    trigger: {
      type: String,
      enum: ['welcome', 'abandoned_cart', 'birthday', 'anniversary', 'order_completed', null],
      default: null
    },
    delay: {
      type: Number,
      default: 0
    },
    conditions: {
      type: mongoose.Schema.Types.Mixed
    }
  },

  // Approvals & Comments Matrix
  approvers: [{
    name: { type: String, required: true },
    role: { type: String, required: true },
    status: {
      type: String,
      enum: ['Approved', 'Pending', 'Rejected'],
      default: 'Pending'
    }
  }],
  comments: [{
    user: { type: String, required: true },
    text: { type: String, required: true },
    time: { type: String, required: true }
  }],
  
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

// Indexes
campaignSchema.index({ userId: 1, status: 1 });
campaignSchema.index({ userId: 1, createdAt: -1 });
campaignSchema.index({ userId: 1, 'automation.trigger': 1 });
campaignSchema.index({ scheduledFor: 1 }, { sparse: true });
campaignSchema.index({ brevoCampaignId: 1 });
campaignSchema.index({ brevoMessageId: 1 });
campaignSchema.index({ 'recipients.email': 1 });
campaignSchema.index({ 'recipients.status': 1 });

// Virtual for campaign performance
campaignSchema.virtual('performance').get(function() {
  return {
    openRate: this.statistics.openRate,
    clickRate: this.statistics.clickRate,
    bounceRate: this.statistics.bounceRate,
    totalEngagement: this.statistics.uniqueOpens + this.statistics.uniqueClicks
  };
});

// Virtual for delivery rate
campaignSchema.virtual('deliveryRate').get(function() {
  if (this.statistics.sentCount === 0) return 0;
  return Math.round((this.statistics.deliveredCount / this.statistics.sentCount) * 100);
});

// Method to update statistics
// In models/Campaign.js - Replace the updateStatistics method with this:

campaignSchema.methods.updateStatistics = async function(eventType, email = null) {
  const stats = this.statistics;
  
  console.log(`📊 Updating statistics for campaign ${this.name}: ${eventType} for ${email}`);
  
  switch(eventType) {
    case 'sent':
      stats.sentCount++;
      this.sentCount++;
      break;
    case 'delivered':
      stats.deliveredCount++;
      console.log(`   Delivered count: ${stats.deliveredCount}`);
      break;
    case 'opened':
      stats.openCount++;
      stats.uniqueOpens++;
      // Update recipient status if found
      if (email) {
        const recipient = this.recipients.find(r => r.email === email);
        if (recipient && recipient.status !== 'opened') {
          recipient.status = 'opened';
          recipient.openedAt = new Date();
        }
      }
      break;
    case 'clicked':
      stats.clickCount++;
      stats.uniqueClicks++;
      // Update recipient status if found
      if (email) {
        const recipient = this.recipients.find(r => r.email === email);
        if (recipient && recipient.status !== 'clicked') {
          recipient.status = 'clicked';
          recipient.clickedAt = new Date();
        }
      }
      break;
    case 'bounced':
      stats.bounceCount++;
      if (email) {
        const recipient = this.recipients.find(r => r.email === email);
        if (recipient) recipient.status = 'bounced';
      }
      break;
    case 'complained':
      stats.complaintCount++;
      if (email) {
        const recipient = this.recipients.find(r => r.email === email);
        if (recipient) recipient.status = 'complained';
      }
      break;
  }
  
  // Recalculate rates - USE SENT COUNT AS FALLBACK
  const denominator = stats.deliveredCount > 0 ? stats.deliveredCount : stats.sentCount;
  
  if (denominator > 0) {
    stats.openRate = Math.round((stats.uniqueOpens / denominator) * 100 * 100) / 100;
    stats.clickRate = Math.round((stats.uniqueClicks / denominator) * 100 * 100) / 100;
    stats.bounceRate = Math.round((stats.bounceCount / (stats.sentCount || 1)) * 100 * 100) / 100;
    
    // Cap at 100%
    stats.openRate = Math.min(stats.openRate, 100);
    stats.clickRate = Math.min(stats.clickRate, 100);
    stats.bounceRate = Math.min(stats.bounceRate, 100);
  }
  
  // Update total recipients count
  if (this.recipients && this.recipients.length > 0) {
    stats.totalRecipients = this.recipients.length;
  } else if (this.targetEmails && this.targetEmails.length > 0) {
    stats.totalRecipients = this.targetEmails.length;
  }
  
  await this.save();
  console.log(`   New stats - Opens: ${stats.uniqueOpens}, Open Rate: ${stats.openRate}%`);
  
  return this;
};

// Method to add recipients from CSV
campaignSchema.methods.addRecipients = async function(recipientsList) {
  for (const recipient of recipientsList) {
    // Check if recipient already exists
    const existingIndex = this.recipients.findIndex(r => r.email === recipient.email);
    
    const recipientData = {
      email: recipient.email,
      name: recipient.name || recipient.email.split('@')[0],
      personalizedSubject: recipient.subject || this.subject,
      personalizedContent: recipient.content || this.content,
      customFields: recipient.customFields || {},
      status: 'pending'
    };
    
    if (existingIndex >= 0) {
      // Update existing
      this.recipients[existingIndex] = { ...this.recipients[existingIndex], ...recipientData };
    } else {
      // Add new
      this.recipients.push(recipientData);
    }
  }
  
  this.recipientCount = this.recipients.length;
  this.statistics.totalRecipients = this.recipients.length;
  await this.save();
  
  return this;
};

// Method to update recipient status
campaignSchema.methods.updateRecipientStatus = async function(email, status, metadata = {}) {
  const recipient = this.recipients.find(r => r.email === email);
  if (recipient) {
    recipient.status = status;
    if (status === 'sent') recipient.sentAt = new Date();
    if (status === 'opened') recipient.openedAt = new Date();
    if (status === 'clicked') recipient.clickedAt = new Date();
    if (metadata.errorMessage) recipient.errorMessage = metadata.errorMessage;
    await this.save();
  }
  return recipient;
};

// Method to get pending recipients
campaignSchema.methods.getPendingRecipients = function() {
  return this.recipients.filter(r => r.status === 'pending');
};

// Method to get failed recipients
campaignSchema.methods.getFailedRecipients = function() {
  return this.recipients.filter(r => r.status === 'failed');
};

// Method to get sent recipients
campaignSchema.methods.getSentRecipients = function() {
  return this.recipients.filter(r => r.status === 'sent');
};

// Method to get recipient statistics
campaignSchema.methods.getRecipientStats = function() {
  return {
    total: this.recipients.length,
    pending: this.recipients.filter(r => r.status === 'pending').length,
    sent: this.recipients.filter(r => r.status === 'sent').length,
    failed: this.recipients.filter(r => r.status === 'failed').length,
    opened: this.recipients.filter(r => r.status === 'opened').length,
    clicked: this.recipients.filter(r => r.status === 'clicked').length,
    bounced: this.recipients.filter(r => r.status === 'bounced').length,
    complained: this.recipients.filter(r => r.status === 'complained').length
  };
};

// Static method to find campaigns by recipient email
campaignSchema.statics.findByRecipientEmail = function(email) {
  return this.find({ 'recipients.email': email });
};

// Static method to get campaign summary for user
campaignSchema.statics.getUserCampaignSummary = async function(userId) {
  const summary = await this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalRecipients: { $sum: '$statistics.totalRecipients' },
        totalOpens: { $sum: '$statistics.openCount' },
        totalClicks: { $sum: '$statistics.clickCount' }
      }
    }
  ]);
  
  return summary;
};

// Pre-save middleware
campaignSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Update recipient count if recipients array changed
  if (this.isModified('recipients')) {
    this.recipientCount = this.recipients.length;
    this.statistics.totalRecipients = this.recipients.length;
  }
  
  // Set type to personalized if there are recipients
  if (this.recipients && this.recipients.length > 0 && this.type === 'regular') {
    this.type = 'personalized';
  }
  
  next();
});

// Pre-remove middleware
campaignSchema.pre('remove', async function(next) {
  // Remove all associated events
  await mongoose.model('CampaignEvent').deleteMany({ campaignId: this._id });
  next();
});

module.exports = mongoose.model('Campaign', campaignSchema);