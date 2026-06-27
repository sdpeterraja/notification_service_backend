// controllers/campaignController.js
const mongoose = require('mongoose');
const Campaign = require('../models/Campaign');
const Template = require('../models/Template');
const BrevoConfig = require('../models/BrevoConfig');
const CampaignEvent = require('../models/CampaignEvent');
const SibApiV3Sdk = require('sib-api-v3-sdk');
const Subscriber = require('../models/Subscriber');  // ADD THIS

class CampaignController {
  constructor() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }
  
  // Helper method to initialize Brevo SDK
  initializeBrevoSDK() {
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKey = defaultClient.authentications['api-key'];
    apiKey.apiKey = process.env.BREVO_API_KEY;
    
    if (!apiKey.apiKey) {
      throw new Error('BREVO_API_KEY is not set in environment variables');
    }
    
    return apiKey.apiKey;
  }
  
  // Get all campaigns
  async getCampaigns(req, res) {
    try {
      const { status, type, page = 1, limit = 10, search, period } = req.query;
      const query = { userId: req.user.userId };
      
      if (status && status !== 'all') query.status = status;
      if (type && type !== 'all') query.type = type;
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { subject: { $regex: search, $options: 'i' } }
        ];
      }
      if (period && period !== 'all') {
        const days = parseInt(period);
        if (!isNaN(days)) {
          const dateLimit = new Date();
          dateLimit.setDate(dateLimit.getDate() - days);
          query.createdAt = { $gte: dateLimit };
        }
      }
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const [campaigns, total] = await Promise.all([
        Campaign.find(query)
          .populate('templateId', 'name previewImage')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Campaign.countDocuments(query)
      ]);
      
      res.json({
        success: true,
        data: campaigns,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get campaigns error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch campaigns'
      });
    }
  }
  
  // Get single campaign (FULL campaign data)
  async getCampaign(req, res) {
    try {
      const { id } = req.params;
      
      const campaign = await Campaign.findOne({
        _id: id,
        userId: req.user.userId
      }).populate('templateId', 'name previewImage content');
      
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      res.json({
        success: true,
        data: campaign
      });
    } catch (error) {
      console.error('Get campaign error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch campaign'
      });
    }
  }
  
  // Create campaign
  async createCampaign(req, res) {
    try {
      console.log('Create campaign request body:', req.body);
      
      const {
        name,
        subject,
        replyTo,
        templateId,
        content,
        type,
        audienceList,
        targetEmails,
        scheduledFor,
        recipients,
        attachments
      } = req.body;
      
      if (!name || !subject) {
        return res.status(400).json({
          success: false,
          message: 'Name and subject are required'
        });
      }
      
      const brevoConfig = await BrevoConfig.findOne({ userId: req.user.userId });
      if (!brevoConfig || !brevoConfig.isConnected) {
        return res.status(400).json({
          success: false,
          message: 'Please connect your Brevo account first'
        });
      }
      
      if (!process.env.BREVO_API_KEY) {
        console.error('BREVO_API_KEY is not set in environment variables');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error: Brevo API key missing'
        });
      }
      
      let finalTargetEmails = targetEmails || [];
      let finalRecipients = [];
      
      if (recipients && Array.isArray(recipients) && recipients.length > 0) {
        finalTargetEmails = recipients.map(r => r.email);
        finalRecipients = recipients.map(recipient => ({
          email: recipient.email,
          name: recipient.name || recipient.email.split('@')[0],
          personalizedSubject: recipient.subject || subject,
          personalizedContent: recipient.content || content,
          status: 'pending'
        }));
      }

      let finalAttachments = attachments || [];
      if (templateId && finalAttachments.length === 0) {
        try {
          const template = await Template.findById(templateId);
          if (template && template.attachments && template.attachments.length > 0) {
            finalAttachments = template.attachments.map(att => ({
              url: att.url,
              name: att.name,
              content: att.content
            }));
          }
        } catch (templateErr) {
          console.error('Error fetching template attachments:', templateErr);
        }
      }
      
      const campaignData = {
        userId: req.user.userId,
        name,
        subject,
        replyTo: replyTo || null,
        templateId: templateId || null,
        content: content || null,
        attachments: finalAttachments,
        type: finalRecipients.length > 0 ? 'personalized' : (type || 'regular'),
        audienceList: audienceList || null,
        targetEmails: finalTargetEmails,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
        status: scheduledFor ? 'scheduled' : 'draft',
        recipients: finalRecipients,
        recipientCount: finalRecipients.length,
        statistics: {
          totalRecipients: finalRecipients.length || finalTargetEmails.length || 0,
          sentCount: 0,
          deliveredCount: 0,
          openCount: 0,
          clickCount: 0,
          bounceCount: 0,
          complaintCount: 0,
          uniqueOpens: 0,
          uniqueClicks: 0,
          openRate: 0,
          clickRate: 0,
          bounceRate: 0
        }
      };
      
      const campaign = await Campaign.create(campaignData);
      
      if (templateId) {
        try {
          await Template.findByIdAndUpdate(templateId, { $inc: { usageCount: 1 } });
          console.log(`Incremented usageCount for template: ${templateId}`);
        } catch (updateErr) {
          console.error('Error incrementing template usageCount:', updateErr);
        }
      }
      
      res.status(201).json({
        success: true,
        data: campaign,
        message: `Campaign created with ${campaign.recipientCount || campaign.targetEmails.length} recipients`
      });
    } catch (error) {
      console.error('Create campaign error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create campaign: ' + error.message
      });
    }
  }
  
  // Update campaign
  async updateCampaign(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const campaign = await Campaign.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      if (campaign.status === 'sent') {
        return res.status(400).json({
          success: false,
          message: 'Cannot update a sent campaign'
        });
      }
      
      delete updateData.statistics;
      delete updateData.brevoCampaignId;
      delete updateData.brevoMessageId;
      delete updateData.sentAt;
      
      if (updateData.scheduledFor) {
        updateData.scheduledFor = new Date(updateData.scheduledFor);
        updateData.status = 'scheduled';
      }
      
      Object.assign(campaign, updateData);
      campaign.updatedAt = new Date();
      await campaign.save();
      
      res.json({
        success: true,
        data: campaign
      });
    } catch (error) {
      console.error('Update campaign error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update campaign'
      });
    }
  }
  
  // Send campaign
// Send campaign - FIXED VERSION
// Send campaign
async sendCampaign(req, res) {
  try {
    const { id } = req.params;
    
    const campaign = await Campaign.findOne({
      _id: id,
      userId: req.user.userId
    }).populate('templateId');
    
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }
    
    if (campaign.status === 'sent') {
      return res.status(400).json({
        success: false,
        message: 'Campaign already sent'
      });
    }
    
    const brevoConfig = await BrevoConfig.findOne({ userId: req.user.userId });
    if (!brevoConfig || !brevoConfig.isConnected) {
      return res.status(400).json({
        success: false,
        message: 'Brevo account not connected'
      });
    }
    
    const activeApiKey = brevoConfig.apiKey || process.env.BREVO_API_KEY;
    if (!activeApiKey) {
      console.error('Brevo API key is missing (neither user configured nor in environment)');
      return res.status(400).json({
        success: false,
        message: 'Brevo API key is not configured. Please connect your Brevo channel in Settings.'
      });
    }
    
    const defaultClient = SibApiV3Sdk.ApiClient.instance;
    const apiKey = defaultClient.authentications['api-key'];
    apiKey.apiKey = activeApiKey;
    
    console.log('Brevo API Key loaded for campaign dispatch');
    
    campaign.status = 'sending';
    await campaign.save();
    
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];
    let brevoCampaignId = null;
    let brevoMessageId = null;
    const messageIds = [];
    
    // Case 1: Send to individual personalized recipients (Transactional API)
    if (campaign.recipients && campaign.recipients.length > 0) {
      console.log(`Sending ${campaign.recipients.length} personalized emails using Brevo messageVersions...`);
      
      const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
      const batchSize = 100;
      
      for (let i = 0; i < campaign.recipients.length; i += batchSize) {
        const batch = campaign.recipients.slice(i, i + batchSize);
        
        try {
          const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
          sendSmtpEmail.sender = {
            name: brevoConfig.senderName || 'CampaignFlow',
            email: brevoConfig.senderEmail
          };
          
          if (campaign.replyTo) {
            sendSmtpEmail.replyTo = {
              email: campaign.replyTo,
              name: campaign.replyTo.split('@')[0]
            };
          } else {
            sendSmtpEmail.replyTo = {
              email: brevoConfig.senderEmail,
              name: brevoConfig.senderName || 'CampaignFlow'
            };
          }
          
          // Set global root-level fields (required by Brevo schema validation when using messageVersions)
          sendSmtpEmail.subject = campaign.subject || 'Campaign';
          sendSmtpEmail.htmlContent = campaign.content || 'Content';
          
          if (campaign.attachments && campaign.attachments.length > 0) {
            sendSmtpEmail.attachment = campaign.attachments.map(att => ({
              ...(att.url ? { url: att.url } : {}),
              ...(att.name ? { name: att.name } : {}),
              ...(att.content ? { content: att.content } : {})
            }));
          }
          
          // Construct messageVersions for personalization and batching
          sendSmtpEmail.messageVersions = batch.map(recipient => {
            const emailContent = recipient.personalizedContent || campaign.content;
            const emailSubject = recipient.subject || campaign.subject;
            return {
              to: [{
                email: recipient.email,
                name: recipient.name || recipient.email.split('@')[0]
              }],
              subject: emailSubject,
              htmlContent: emailContent
            };
          });
          
          console.log(`Sending batch of ${batch.length} personalized emails (offset: ${i})...`);
          const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
          const returnedIds = response.messageIds || [];
          console.log(`Batch sent successfully. Received ${returnedIds.length} message IDs.`);
          
          for (let j = 0; j < batch.length; j++) {
            const recipient = batch[j];
            const mId = returnedIds[j] || (response.messageId ? `${response.messageId}-${j}` : `batch-${i}-${j}`);
            
            recipient.status = 'sent';
            recipient.sentAt = new Date();
            recipient.messageId = mId;
            messageIds.push(mId);
            sentCount++;
            
            if (!brevoMessageId) {
              brevoMessageId = mId;
            }
          }
        } catch (error) {
          console.log(error)
          console.error(`Failed to send personalized batch at offset ${i}:`, error.message);
          for (const recipient of batch) {
            recipient.status = 'failed';
            recipient.errorMessage = error.message;
            failedCount++;
            errors.push({ email: recipient.email, error: error.message });
          }
        }
        
        // Wait 300ms between batches to respect rate limits gently
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      // Store message IDs for webhook matching
      if (brevoMessageId) {
        campaign.brevoMessageId = brevoMessageId;
        await campaign.save();
        console.log(`✅ Saved brevoMessageId: ${brevoMessageId} to campaign ${campaign._id}`);
      }
      
    } 
    // Case 2: Send to target emails list (Transactional API - Bulk with messageVersions)
    else if (campaign.targetEmails && campaign.targetEmails.length > 0) {
      console.log(`Sending bulk email to ${campaign.targetEmails.length} recipients using Brevo messageVersions...`);
      
      const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
      const emailContent = campaign.content;
      const emailSubject = campaign.subject;
      const batchSize = 100;
      
      for (let i = 0; i < campaign.targetEmails.length; i += batchSize) {
        const batch = campaign.targetEmails.slice(i, i + batchSize);
        
        try {
          const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
          sendSmtpEmail.sender = {
            name: brevoConfig.senderName || 'CampaignFlow',
            email: brevoConfig.senderEmail
          };
          
          if (campaign.replyTo) {
            sendSmtpEmail.replyTo = {
              email: campaign.replyTo,
              name: campaign.replyTo.split('@')[0]
            };
          } else {
            sendSmtpEmail.replyTo = {
              email: brevoConfig.senderEmail,
              name: brevoConfig.senderName || 'CampaignFlow'
            };
          }
          
          // Set global root-level fields (required by Brevo schema validation when using messageVersions)
          sendSmtpEmail.subject = emailSubject || 'Campaign';
          sendSmtpEmail.htmlContent = emailContent || 'Content';
          
          if (campaign.attachments && campaign.attachments.length > 0) {
            sendSmtpEmail.attachment = campaign.attachments.map(att => ({
              ...(att.url ? { url: att.url } : {}),
              ...(att.name ? { name: att.name } : {}),
              ...(att.content ? { content: att.content } : {})
            }));
          }
          
          // Use messageVersions so each recipient gets an individual email copy (privacy compliant)
          sendSmtpEmail.messageVersions = batch.map(email => ({
            to: [{ 
              email, 
              name: email.split('@')[0] 
            }],
            subject: emailSubject,
            htmlContent: emailContent
          }));
          
          console.log(`Sending batch of ${batch.length} bulk emails (offset: ${i})...`);
          const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
          const returnedIds = response.messageIds || [];
          console.log(`Batch sent successfully. Received ${returnedIds.length} message IDs.`);
          
          sentCount += batch.length;
          
          for (let j = 0; j < batch.length; j++) {
            const mId = returnedIds[j] || (response.messageId ? `${response.messageId}-${j}` : `batch-${i}-${j}`);
            messageIds.push(mId);
            
            if (!brevoMessageId) {
              brevoMessageId = mId;
            }
          }
        } catch (error) {
          console.error(`Failed to send bulk batch at offset ${i}:`, error.message);
          failedCount += batch.length;
          errors.push({ batch: i, error: error.message });
        }
        
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      // Store message ID for webhook matching
      if (brevoMessageId) {
        campaign.brevoMessageId = brevoMessageId;
        await campaign.save();
        console.log(`✅ Saved brevoMessageId: ${brevoMessageId} to campaign ${campaign._id}`);
      }
      
    } 
    // Case 3: Send to Brevo list (Email Campaigns API)
    else if (campaign.audienceList) {
      console.log(`Sending to Brevo list: ${campaign.audienceList}`);
      
      const apiInstance = new SibApiV3Sdk.EmailCampaignsApi();
      
      const emailCampaign = new SibApiV3Sdk.CreateEmailCampaign();
      emailCampaign.name = campaign.name;
      emailCampaign.subject = campaign.subject;
      emailCampaign.htmlContent = campaign.content;
      emailCampaign.sender = {
        name: brevoConfig.senderName || 'CampaignFlow',
        email: brevoConfig.senderEmail
      };
      emailCampaign.recipients = {
        listIds: [parseInt(campaign.audienceList)]
      };
      
      if (campaign.replyTo) {
        emailCampaign.replyTo = campaign.replyTo;
      }
      
      const response = await apiInstance.createEmailCampaign(emailCampaign);
      brevoCampaignId = response.body.id;
      
      console.log(`✅ Created Brevo campaign with ID: ${brevoCampaignId}`);
      
      await apiInstance.sendEmailCampaignNow(brevoCampaignId);
      
      campaign.brevoCampaignId = brevoCampaignId;
      await campaign.save();
      
      console.log(`✅ Saved brevoCampaignId ${brevoCampaignId} to campaign ${campaign._id}`);
      
      sentCount = 0; // Will be updated via webhook
      
    } 
    else {
      throw new Error('No recipients specified');
    }
    
    // Update campaign status
    campaign.status = 'sent';
    campaign.sentAt = new Date();
    campaign.sentCount = sentCount;
    campaign.failedCount = failedCount;
    campaign.statistics.sentCount = sentCount;
    campaign.statistics.totalRecipients = sentCount + failedCount;
    
    await campaign.save();
    
    // Log campaign event
    try {
      await CampaignEvent.create({
        campaignId: campaign._id,
        type: 'sent',
        metadata: {
          sentCount,
          failedCount,
          totalRecipients: sentCount + failedCount,
          brevoCampaignId: brevoCampaignId,
          brevoMessageId: brevoMessageId,
          messageIds: messageIds,
          errors: errors.length > 0 ? errors : undefined
        }
      });
    } catch (eventError) {
      console.error('Failed to create campaign event:', eventError);
    }
    
    res.json({
      success: true,
      data: {
        sentCount,
        failedCount,
        totalRecipients: sentCount + failedCount,
        brevoCampaignId: brevoCampaignId,
        brevoMessageId: brevoMessageId,
        errors: errors.length > 0 ? errors : undefined
      },
      message: `Campaign sent to ${sentCount} of ${sentCount + failedCount} recipients`
    });
    
  } catch (error) {
    console.error('Send campaign error:', error);
    
    try {
      await Campaign.findByIdAndUpdate(req.params.id, {
        status: 'failed'
      });
    } catch (updateError) {
      console.error('Failed to update campaign status:', updateError);
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send campaign'
    });
  }
}
  
  // Send test email
  async sendTestEmail(req, res) {
    try {
      const { id } = req.params;
      const { testEmails } = req.body;
      
      if (!testEmails || !Array.isArray(testEmails) || testEmails.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one test email is required'
        });
      }
      
      const campaign = await Campaign.findOne({
        _id: id,
        userId: req.user.userId
      }).populate('templateId');
      
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      const brevoConfig = await BrevoConfig.findOne({ userId: req.user.userId });
      if (!brevoConfig || !brevoConfig.isConnected) {
        return res.status(400).json({
          success: false,
          message: 'Brevo account not connected'
        });
      }
      
      if (!process.env.BREVO_API_KEY) {
        console.error('BREVO_API_KEY is not set in environment variables');
        return res.status(500).json({
          success: false,
          message: 'Server configuration error: Brevo API key missing'
        });
      }
      
      const defaultClient = SibApiV3Sdk.ApiClient.instance;
      const apiKey = defaultClient.authentications['api-key'];
      apiKey.apiKey = process.env.BREVO_API_KEY;
      
      const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
      const results = [];
      
      for (const testEmail of testEmails) {
        try {
          const emailContent = campaign.content || (campaign.templateId?.content);
          const emailSubject = campaign.subject;
          
          const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
          sendSmtpEmail.subject = emailSubject;
          sendSmtpEmail.htmlContent = emailContent;
          
          if (campaign.attachments && campaign.attachments.length > 0) {
            sendSmtpEmail.attachment = campaign.attachments.map(att => ({
              ...(att.url ? { url: att.url } : {}),
              ...(att.name ? { name: att.name } : {}),
              ...(att.content ? { content: att.content } : {})
            }));
          }
          
          sendSmtpEmail.sender = {
            name: brevoConfig.senderName || 'CampaignFlow',
            email: brevoConfig.senderEmail
          };
          sendSmtpEmail.to = [{ 
            email: testEmail, 
            name: 'Test User' 
          }];
          
          const response = await apiInstance.sendTransacEmail(sendSmtpEmail);
          
          results.push({
            email: testEmail,
            success: true,
            messageId: response.messageId
          });
          
        } catch (error) {
          console.error(`Failed to send test email to ${testEmail}:`, error.message);
          results.push({
            email: testEmail,
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      res.json({
        success: true,
        data: {
          results,
          summary: {
            total: testEmails.length,
            sent: successCount,
            failed: failCount
          }
        },
        message: `Test emails sent: ${successCount} succeeded, ${failCount} failed`
      });
    } catch (error) {
      console.error('Send test email error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send test emails: ' + error.message
      });
    }
  }
  
  // Duplicate campaign
  async duplicateCampaign(req, res) {
    try {
      const { id } = req.params;
      
      const original = await Campaign.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!original) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      const campaignData = original.toObject();
      delete campaignData._id;
      delete campaignData.createdAt;
      delete campaignData.updatedAt;
      delete campaignData.statistics;
      delete campaignData.brevoCampaignId;
      delete campaignData.brevoMessageId;
      delete campaignData.sentAt;
      
      campaignData.name = `${original.name} (Copy)`;
      campaignData.status = 'draft';
      
      const duplicated = await Campaign.create(campaignData);
      
      if (duplicated.templateId) {
        try {
          await Template.findByIdAndUpdate(duplicated.templateId, { $inc: { usageCount: 1 } });
          console.log(`Incremented usageCount for template on duplication: ${duplicated.templateId}`);
        } catch (updateErr) {
          console.error('Error incrementing template usageCount on duplication:', updateErr);
        }
      }
      
      res.status(201).json({
        success: true,
        data: duplicated
      });
    } catch (error) {
      console.error('Duplicate campaign error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to duplicate campaign'
      });
    }
  }
  
  // Delete campaign
  async deleteCampaign(req, res) {
    try {
      const { id } = req.params;
      
      const campaign = await Campaign.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      if (campaign.status === 'sending') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete a campaign while it is being sent'
        });
      }
      
      await CampaignEvent.deleteMany({ campaignId: id });
      await campaign.deleteOne();
      
      res.json({
        success: true,
        message: 'Campaign deleted successfully'
      });
    } catch (error) {
      console.error('Delete campaign error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete campaign'
      });
    }
  }
  
  // Get campaign statistics (ONLY stats data)
  async getCampaignStats(req, res) {
    try {
      const { id } = req.params;
      
      const campaign = await Campaign.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      // Calculate recipient count safely
      let recipientCount = campaign.recipientCount || 0;
      if (!recipientCount && campaign.targetEmails) {
        recipientCount = campaign.targetEmails.length;
      }
      if (!recipientCount && campaign.recipients) {
        recipientCount = Array.isArray(campaign.recipients) ? campaign.recipients.length : 0;
      }
      
      let recipientStats = null;
      if (campaign.recipients && Array.isArray(campaign.recipients) && campaign.recipients.length > 0) {
        recipientStats = {
          total: campaign.recipients.length,
          sent: campaign.recipients.filter(r => r.status === 'sent').length,
          failed: campaign.recipients.filter(r => r.status === 'failed').length,
          pending: campaign.recipients.filter(r => r.status === 'pending').length
        };
      }
      
      // Recalculate rates on the fly for accuracy
      const stats = campaign.statistics.toObject ? campaign.statistics.toObject() : { ...campaign.statistics };
      const denominator = stats.deliveredCount > 0 ? stats.deliveredCount : stats.sentCount;
      
      if (denominator > 0) {
        stats.openRate = Math.min(Math.round((stats.uniqueOpens / denominator) * 100 * 100) / 100, 100);
        stats.clickRate = Math.min(Math.round((stats.uniqueClicks / denominator) * 100 * 100) / 100, 100);
      }
      
      // Return statistics data with recalculated rates
      res.json({
        success: true,
        data: {
          statistics: stats,
          status: campaign.status,
          sentAt: campaign.sentAt,
          recipientCount: recipientCount,
          recipientStats: recipientStats,
          name: campaign.name,
          subject: campaign.subject,
          brevoCampaignId: campaign.brevoCampaignId
        }
      });
    } catch (error) {
      console.error('Get campaign stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch campaign statistics'
      });
    }
  }

  // Refresh campaign statistics
  async refreshCampaignStats(req, res) {
    try {
      const { id } = req.params;
      
      const campaign = await Campaign.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      // Force recalculate rates
      const denominator = campaign.statistics.deliveredCount > 0 
        ? campaign.statistics.deliveredCount 
        : campaign.statistics.sentCount;
      
      if (denominator > 0) {
        campaign.statistics.openRate = Math.min(
          Math.round((campaign.statistics.uniqueOpens / denominator) * 100 * 100) / 100, 
          100
        );
        campaign.statistics.clickRate = Math.min(
          Math.round((campaign.statistics.uniqueClicks / denominator) * 100 * 100) / 100, 
          100
        );
        await campaign.save();
      }
      
      res.json({
        success: true,
        data: campaign.statistics,
        message: 'Statistics refreshed successfully'
      });
    } catch (error) {
      console.error('Refresh stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to refresh statistics'
      });
    }
  }

  // Debug: Check campaign brevoCampaignId
  async debugCampaignBrevoId(req, res) {
    try {
      const { id } = req.params;
      
      const campaign = await Campaign.findOne({
        _id: id,
        userId: req.user.userId
      }).select('name brevoCampaignId status sentAt subject');
      
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      res.json({
        success: true,
        data: {
          name: campaign.name,
          brevoCampaignId: campaign.brevoCampaignId,
          status: campaign.status,
          sentAt: campaign.sentAt,
          subject: campaign.subject,
          hasBrevoId: !!campaign.brevoCampaignId
        }
      });
    } catch (error) {
      console.error('Debug error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // controllers/campaignController.js - Add this method

// Get overall stats across all campaigns
  async getOverallStats(req, res) {
    try {
      const userId = req.user.userId;
      
      // Get all campaigns for the user
      const campaigns = await Campaign.find({ 
        userId, 
        status: 'sent' 
      });
      
      // Get subscriber count
      const subscriberCount = await Subscriber.countDocuments({ userId });
      
      // Get template count
      const templateCount = await Template.countDocuments({ userId });
      
      // Calculate aggregated stats
      let totalSent = 0;
      let totalDelivered = 0;
      let totalOpens = 0;
      let totalUniqueOpens = 0;
      let totalClicks = 0;
      let totalUniqueClicks = 0;
      let totalBounces = 0;
      let totalComplaints = 0;
      let campaignCount = campaigns.length;
      
      for (const campaign of campaigns) {
        const stats = campaign.statistics;
        totalSent += stats.sentCount || 0;
        totalDelivered += stats.deliveredCount || 0;
        totalOpens += stats.openCount || 0;
        totalUniqueOpens += stats.uniqueOpens || 0;
        totalClicks += stats.clickCount || 0;
        totalUniqueClicks += stats.uniqueClicks || 0;
        totalBounces += stats.bounceCount || 0;
        totalComplaints += stats.complaintCount || 0;
      }
      
      // Calculate overall rates
      const effectiveDelivered = totalDelivered > 0 ? totalDelivered : totalSent;
      const overallOpenRate = effectiveDelivered > 0 ? (totalUniqueOpens / effectiveDelivered) * 100 : 0;
      const overallClickRate = effectiveDelivered > 0 ? (totalUniqueClicks / effectiveDelivered) * 100 : 0;
      const overallBounceRate = totalSent > 0 ? (totalBounces / totalSent) * 100 : 0;
      
      // Get monthly stats for chart
      const monthlyStats = await Campaign.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            status: 'sent',
            sentAt: { $exists: true, $ne: null }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$sentAt' },
              month: { $month: '$sentAt' }
            },
            campaigns: { $sum: 1 },
            sentCount: { $sum: '$statistics.sentCount' },
            uniqueOpens: { $sum: '$statistics.uniqueOpens' },
            uniqueClicks: { $sum: '$statistics.uniqueClicks' },
            deliveredCount: { $sum: '$statistics.deliveredCount' }
          }
        },
        {
          $project: {
            date: {
              $dateFromParts: {
                year: '$_id.year',
                month: '$_id.month',
                day: 1
              }
            },
            campaigns: 1,
            sentCount: 1,
            uniqueOpens: 1,
            uniqueClicks: 1,
            deliveredCount: 1,
            openRate: {
              $cond: [
                { $gt: ['$deliveredCount', 0] },
                { $multiply: [{ $divide: ['$uniqueOpens', '$deliveredCount'] }, 100] },
                { $multiply: [{ $divide: ['$uniqueOpens', '$sentCount'] }, 100] }
              ]
            },
            clickRate: {
              $cond: [
                { $gt: ['$deliveredCount', 0] },
                { $multiply: [{ $divide: ['$uniqueClicks', '$deliveredCount'] }, 100] },
                { $multiply: [{ $divide: ['$uniqueClicks', '$sentCount'] }, 100] }
              ]
            }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 12 }
      ]);
      
      // Get top performing campaigns
      const topCampaigns = await Campaign.find({ userId, status: 'sent' })
        .sort({ 'statistics.openRate': -1 })
        .limit(5)
        .select('name statistics sentAt');
      
      res.json({
        success: true,
        data: {
          summary: {
            totalCampaigns: campaignCount,
            totalEmailsSent: totalSent,
            totalDelivered: totalDelivered,
            totalOpens: totalOpens,
            totalUniqueOpens: totalUniqueOpens,
            totalClicks: totalClicks,
            totalUniqueClicks: totalUniqueClicks,
            totalBounces: totalBounces,
            totalComplaints: totalComplaints,
            overallOpenRate: Math.round(overallOpenRate * 100) / 100,
            overallClickRate: Math.round(overallClickRate * 100) / 100,
            overallBounceRate: Math.round(overallBounceRate * 100) / 100,
            subscribers: subscriberCount,
            templates: templateCount
          },
          topCampaigns,
          monthlyStats
        }
      });
    } catch (error) {
      console.error('Get overall stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch overall statistics: ' + error.message
      });
    }
  }
}

module.exports = new CampaignController();