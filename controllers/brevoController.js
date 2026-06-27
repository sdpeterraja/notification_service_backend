// controllers/brevoController.js
const BrevoConfig = require('../models/BrevoConfig');
const Campaign = require('../models/Campaign');
const Subscriber = require('../models/Subscriber');
const Template = require('../models/Template');
const BrevoService = require('../services/brevoService');
const crypto = require('crypto');

class BrevoController {
  constructor() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }

  // Test Brevo connection
  async testConnection(req, res) {
    try {
      const { apiKey } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: 'API key is required'
        });
      }
      
      // Test the connection
      const result = await BrevoService.testConnection(apiKey);
      
      res.json({
        success: true,
        data: result,
        message: 'Connection successful'
      });
    } catch (error) {
      console.error('Test connection error:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Failed to test connection'
      });
    }
  }
  
  // Connect Brevo account
  async connect(req, res) {
    try {
      const { apiKey, senderEmail, senderName, dailyLimit } = req.body;
      console.log(req.body)
      if (!apiKey || !senderEmail) {
        return res.status(400).json({
          success: false,
          message: 'API key and sender email are required'
        });
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(senderEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid sender email format'
        });
      }
      
      // Test the connection first
      try {
  await BrevoService.testConnection(apiKey);
} catch (e) {
  console.error("BREVO TEST FAILED:", e.response?.data || e);
  throw e;
}
      
      // Check if already connected
      let brevoConfig = await BrevoConfig.findOne({ userId: req.user.userId });
      
      if (brevoConfig) {
        // Update existing configuration
        brevoConfig.apiKey = apiKey;
        brevoConfig.senderEmail = senderEmail;
        brevoConfig.senderName = senderName || brevoConfig.senderName;
        brevoConfig.isConnected = true;
        brevoConfig.dailyLimit = dailyLimit || brevoConfig.dailyLimit;
        brevoConfig.updatedAt = new Date();
        await brevoConfig.save();
      } else {
        // Create new configuration
        brevoConfig = await BrevoConfig.create({
          userId: req.user.userId,
          apiKey,
          senderEmail,
          senderName: senderName || null,
          isConnected: true,
          dailyLimit: dailyLimit || 10000,
          webhookUrl: `${process.env.API_URL}/api/webhooks/brevo`
        });
      }
      
      // Log activity
      // await this.logActivity(req.user.userId, 'Brevo connected', req);
      
      res.json({
        success: true,
        data: {
          senderEmail: brevoConfig.senderEmail,
          senderName: brevoConfig.senderName,
          isConnected: brevoConfig.isConnected,
          dailyLimit: brevoConfig.dailyLimit
        },
        message: 'Brevo connected successfully'
      });
    } catch (error) {
      console.error('Connect error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to connect Brevo'
      });
    }
  }
  
  // Disconnect Brevo account
  async disconnect(req, res) {
    try {
      const brevoConfig = await BrevoConfig.findOne({ userId: req.user.userId });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo configuration not found'
        });
      }
      
      // Instead of deleting, just mark as disconnected
      brevoConfig.isConnected = false;
      brevoConfig.disconnectedAt = new Date();
      await brevoConfig.save();
      
      // Log activity
      await this.logActivity(req.user.userId, 'Brevo disconnected', req);
      
      res.json({
        success: true,
        message: 'Brevo disconnected successfully'
      });
    } catch (error) {
      console.error('Disconnect error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to disconnect Brevo'
      });
    }
  }
  
  // Get Brevo connection status
  async getStatus(req, res) {
    try {
      const brevoConfig = await BrevoConfig.findOne({ userId: req.user.userId });
      
      const status = {
        isConnected: false,
        senderEmail: null,
        senderName: null,
        dailyLimit: null,
        creditsRemaining: null,
        connectedAt: null
      };
      
      if (brevoConfig && brevoConfig.isConnected) {
        status.isConnected = true;
        status.senderEmail = brevoConfig.senderEmail;
        status.senderName = brevoConfig.senderName;
        status.dailyLimit = brevoConfig.dailyLimit;
        status.creditsRemaining = brevoConfig.creditsRemaining;
        status.connectedAt = brevoConfig.createdAt;
        
        // Try to get account info from Brevo
        try {
          const accountInfo = await BrevoService.getAccountInfo(brevoConfig.apiKey);
          if (accountInfo) {
            status.creditsRemaining = accountInfo.credits?.remaining || 0;
          }
        } catch (error) {
          console.error('Failed to fetch Brevo account info:', error);
        }
      }
      
      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      console.error('Get status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get Brevo status'
      });
    }
  }
  
  // Get Brevo account info
  async getAccountInfo(req, res) {
    try {
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      const accountInfo = await BrevoService.getAccountInfo(brevoConfig.apiKey);
      
      res.json({
        success: true,
        data: accountInfo
      });
    } catch (error) {
      console.error('Get account info error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get account information'
      });
    }
  }
  
  // Get Brevo lists
  async getLists(req, res) {
    try {
      const { page = 1, limit = 50 } = req.query;
      
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      const lists = await BrevoService.getLists(brevoConfig.apiKey, page, limit);
      
      res.json({
        success: true,
        data: lists
      });
    } catch (error) {
      console.error('Get lists error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch lists'
      });
    }
  }
  
  // Create Brevo list
  async createList(req, res) {
    try {
      const { name, folderId } = req.body;
      
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'List name is required'
        });
      }
      
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      const list = await BrevoService.createList(brevoConfig.apiKey, name, folderId);
      
      res.json({
        success: true,
        data: list,
        message: 'List created successfully'
      });
    } catch (error) {
      console.error('Create list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create list'
      });
    }
  }
  
  // Sync subscribers with Brevo
  async syncSubscribers(req, res) {
    try {
      const { listId, syncExisting = false } = req.body;
      
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      // Get local subscribers
      const query = { userId: req.user.userId };
      if (!syncExisting) {
        query.syncedToBrevo = { $ne: true };
      }
      
      const subscribers = await Subscriber.find(query).limit(1000);
      
      if (subscribers.length === 0) {
        return res.json({
          success: true,
          data: { synced: 0 },
          message: 'No subscribers to sync'
        });
      }
      
      // Prepare contacts for Brevo
      const contacts = subscribers.map(sub => ({
        email: sub.email,
        name: sub.name,
        attributes: sub.attributes || {},
        listIds: listId ? [parseInt(listId)] : (sub.lists || [])
      }));
      
      // Sync to Brevo
      const result = await BrevoService.syncContacts(brevoConfig.apiKey, contacts);
      
      // Mark as synced
      await Subscriber.updateMany(
        { _id: { $in: subscribers.map(s => s._id) } },
        { syncedToBrevo: true, lastSyncedAt: new Date() }
      );
      
      // Log activity
      await this.logActivity(req.user.userId, `Synced ${subscribers.length} subscribers to Brevo`, req);
      
      res.json({
        success: true,
        data: {
          synced: subscribers.length,
          result
        },
        message: `Successfully synced ${subscribers.length} subscribers`
      });
    } catch (error) {
      console.error('Sync subscribers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to sync subscribers'
      });
    }
  }
  
  // Import subscribers from Brevo
  async importSubscribers(req, res) {
    try {
      const { listId, limit = 100 } = req.body;
      
      if (!listId) {
        return res.status(400).json({
          success: false,
          message: 'List ID is required'
        });
      }
      
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      // Get contacts from Brevo list
      const contacts = await BrevoService.getListContacts(brevoConfig.apiKey, listId, limit);
      
      let imported = 0;
      let updated = 0;
      
      // Import to local database
      for (const contact of contacts) {
        const existing = await Subscriber.findOne({ 
          email: contact.email,
          userId: req.user.userId
        });
        
        if (existing) {
          // Update existing
          existing.name = contact.name || existing.name;
          existing.attributes = { ...existing.attributes, ...contact.attributes };
          existing.lists = [...new Set([...existing.lists, listId])];
          existing.lastSyncedAt = new Date();
          await existing.save();
          updated++;
        } else {
          // Create new
          await Subscriber.create({
            userId: req.user.userId,
            email: contact.email,
            name: contact.name,
            attributes: contact.attributes,
            lists: [listId],
            syncedToBrevo: true,
            subscribedAt: new Date()
          });
          imported++;
        }
      }
      
      // Log activity
      await this.logActivity(req.user.userId, `Imported ${imported} subscribers from Brevo`, req);
      
      res.json({
        success: true,
        data: {
          imported,
          updated,
          total: contacts.length
        },
        message: `Imported ${imported} new subscribers, updated ${updated} existing`
      });
    } catch (error) {
      console.error('Import subscribers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to import subscribers'
      });
    }
  }
  
  // Send campaign via Brevo
  async sendCampaign(req, res) {
    try {
      const { campaignId } = req.body;
      
      const campaign = await Campaign.findOne({
        _id: campaignId,
        userId: req.user.userId
      }).populate('templateId');
      
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      // Send via Brevo
      const result = await BrevoService.sendEmailCampaign(campaign, brevoConfig);
      
      // Update campaign
      campaign.status = 'sent';
      campaign.sentAt = new Date();
      campaign.brevoCampaignId = result.campaignId;
      campaign.brevoMessageId = result.messageId;
      await campaign.save();
      
      // Log activity
      await this.logActivity(req.user.userId, `Sent campaign: ${campaign.name}`, req);
      
      res.json({
        success: true,
        data: result,
        message: 'Campaign sent successfully'
      });
    } catch (error) {
      console.error('Send campaign error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to send campaign'
      });
    }
  }
  
  // Get campaign statistics from Brevo
  async getCampaignStats(req, res) {
    try {
      const { brevoCampaignId } = req.params;
      
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      const stats = await BrevoService.getCampaignStats(brevoConfig.apiKey, brevoCampaignId);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Get campaign stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get campaign statistics'
      });
    }
  }
  
  // Get email templates from Brevo
  async getTemplates(req, res) {
    try {
      const { page = 1, limit = 50 } = req.query;
      
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      const templates = await BrevoService.getTemplates(brevoConfig.apiKey, page, limit);
      
      res.json({
        success: true,
        data: templates
      });
    } catch (error) {
      console.error('Get templates error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch templates'
      });
    }
  }
  
  // Import template from Brevo
  async importTemplate(req, res) {
    try {
      const { brevoTemplateId } = req.body;
      
      if (!brevoTemplateId) {
        return res.status(400).json({
          success: false,
          message: 'Template ID is required'
        });
      }
      
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      // Get template from Brevo
      const brevoTemplate = await BrevoService.getTemplate(brevoConfig.apiKey, brevoTemplateId);
      
      // Save to local database
      const template = await Template.create({
        userId: req.user.userId,
        name: brevoTemplate.name,
        subject: brevoTemplate.subject,
        content: brevoTemplate.htmlContent,
        previewImage: brevoTemplate.thumbnailUrl,
        category: 'promotional',
        tags: ['imported', 'brevo'],
        brevoTemplateId: brevoTemplateId
      });
      
      // Log activity
      await this.logActivity(req.user.userId, `Imported template: ${template.name} from Brevo`, req);
      
      res.json({
        success: true,
        data: template,
        message: 'Template imported successfully'
      });
    } catch (error) {
      console.error('Import template error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to import template'
      });
    }
  }
  
  // Update Brevo configuration
  async updateConfig(req, res) {
    try {
      const { senderEmail, senderName, dailyLimit, webhookUrl } = req.body;
      
      const brevoConfig = await BrevoConfig.findOne({ userId: req.user.userId });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo configuration not found'
        });
      }
      
      if (senderEmail) brevoConfig.senderEmail = senderEmail;
      if (senderName) brevoConfig.senderName = senderName;
      if (dailyLimit) brevoConfig.dailyLimit = dailyLimit;
      if (webhookUrl) brevoConfig.webhookUrl = webhookUrl;
      
      brevoConfig.updatedAt = new Date();
      await brevoConfig.save();
      
      // Log activity
      await this.logActivity(req.user.userId, 'Updated Brevo configuration', req);
      
      res.json({
        success: true,
        data: {
          senderEmail: brevoConfig.senderEmail,
          senderName: brevoConfig.senderName,
          dailyLimit: brevoConfig.dailyLimit
        },
        message: 'Configuration updated successfully'
      });
    } catch (error) {
      console.error('Update config error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update configuration'
      });
    }
  }
  
  // Get webhook history
  async getWebhookHistory(req, res) {
    try {
      const { page = 1, limit = 50 } = req.query;
      
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      const history = await BrevoService.getWebhookHistory(brevoConfig.apiKey, page, limit);
      
      res.json({
        success: true,
        data: history
      });
    } catch (error) {
      console.error('Get webhook history error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch webhook history'
      });
    }
  }
  
  // Get transactional logs
  async getTransactions(req, res) {
    try {
      const brevoConfig = await BrevoConfig.findOne({ 
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(404).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      const { limit = 50, startDate, endDate, email, event } = req.query;
      const opts = {
        limit: parseInt(limit),
        sort: 'desc'
      };
      
      if (startDate) opts.startDate = startDate;
      if (endDate) opts.endDate = endDate;
      if (email) opts.email = email;
      if (event) opts.event = event;
      
      const transactions = await BrevoService.getTransacEmailsEvents(brevoConfig.apiKey, opts);
      
      res.json({
        success: true,
        data: transactions
      });
    } catch (error) {
      console.error('Get transactions error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch transactions from Brevo'
      });
    }
  }

  // Helper: Log activity
  async logActivity(userId, action, req) {
    try {
      const User = require('../models/User');
      await User.findByIdAndUpdate(userId, {
        $push: {
          activityLog: {
            action,
            timestamp: new Date(),
            ip: req.ip,
            userAgent: req.headers['user-agent']
          }
        }
      });
    } catch (error) {
      console.error('Log activity error:', error);
    }
  }
}

module.exports = new BrevoController();