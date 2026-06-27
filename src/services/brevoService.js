// services/brevoService.js
const Brevo = require('@getbrevo/brevo');

class BrevoService {
  constructor() {
    this.apiInstance = null;
  }
  
  initialize(apiKey) {
    this.apiInstance = new Brevo.TransactionalEmailsApi();
    this.apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);
    this.campaignApi = new Brevo.EmailCampaignsApi();
    this.campaignApi.setApiKey(Brevo.EmailCampaignsApiApiKeys.apiKey, apiKey);
  }
  
  async sendCampaign(campaign, brevoConfig) {
    this.initialize(brevoConfig.apiKey);
    
    const emailContent = campaign.content || campaign.templateId?.content;
    
    // For list-based sending
    if (campaign.audienceList) {
      const emailCampaign = new Brevo.CreateEmailCampaign();
      emailCampaign.name = campaign.name;
      emailCampaign.subject = campaign.subject;
      emailCampaign.htmlContent = emailContent;
      emailCampaign.sender = {
        name: brevoConfig.senderName || 'CampaignFlow',
        email: brevoConfig.senderEmail
      };
      emailCampaign.recipients = {
        listIds: [parseInt(campaign.audienceList)]
      };
      
      if (campaign.settings.trackOpens) {
        emailCampaign.replyTo = brevoConfig.senderEmail;
      }
      
      const response = await this.campaignApi.createEmailCampaign(emailCampaign);
      const campaignId = response.body.id;
      
      // Send the campaign
      await this.campaignApi.sendEmailCampaignNow(campaignId);
      
      return {
        campaignId,
        recipients: 0,
        messageId: response.body.messageId
      };
    }
    
    // For direct sending to specific emails
    if (campaign.targetEmails && campaign.targetEmails.length > 0) {
      const batchSize = 100;
      let firstMessageId = null;
      
      for (let i = 0; i < campaign.targetEmails.length; i += batchSize) {
        const batch = campaign.targetEmails.slice(i, i + batchSize);
        const sendSmtpEmail = new Brevo.SendSmtpEmail();
        sendSmtpEmail.sender = {
          name: brevoConfig.senderName || 'CampaignFlow',
          email: brevoConfig.senderEmail
        };
        
        if (campaign.settings.trackOpens) {
          sendSmtpEmail.replyTo = brevoConfig.senderEmail;
        }
        
        // Set global root-level fields (required by Brevo schema validation when using messageVersions)
        sendSmtpEmail.subject = campaign.subject || 'Campaign';
        sendSmtpEmail.htmlContent = emailContent || 'Content';
        
        if (campaign.attachments && campaign.attachments.length > 0) {
          sendSmtpEmail.attachment = campaign.attachments.map(att => ({
            ...(att.url ? { url: att.url } : {}),
            ...(att.name ? { name: att.name } : {}),
            ...(att.content ? { content: att.content } : {})
          }));
        }
        
        // Use messageVersions for bulk sending individually
        sendSmtpEmail.messageVersions = batch.map(email => ({
          to: [{ email }],
          subject: campaign.subject,
          htmlContent: emailContent
        }));
        
        const response = await this.apiInstance.sendTransacEmail(sendSmtpEmail);
        const returnedIds = response.messageIds || [];
        if (!firstMessageId) {
          firstMessageId = returnedIds[0] || response.messageId;
        }
        
        if (i + batchSize < campaign.targetEmails.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      return {
        recipients: campaign.targetEmails.length,
        messageId: firstMessageId
      };
    }
    
    throw new Error('No recipients specified');
  }
  
  async sendTestEmail(campaign, brevoConfig, testEmails) {
    this.initialize(brevoConfig.apiKey);
    
    const emailContent = campaign.content || campaign.templateId?.content;
    const sendSmtpEmail = new Brevo.SendSmtpEmail();
    sendSmtpEmail.subject = campaign.subject;
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
    sendSmtpEmail.to = testEmails.map(email => ({ email }));
    
    const response = await this.apiInstance.sendTransacEmail(sendSmtpEmail);
    
    return {
      messageId: response.messageId,
      emails: testEmails
    };
  }
  
  async testConnection(apiKey) {
    try {
      const testInstance = new Brevo.TransactionalEmailsApi();
      testInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);
      
      const accountApi = new Brevo.AccountApi();
      accountApi.setApiKey(Brevo.AccountApiApiKeys.apiKey, apiKey);
      
      const accountInfo = await accountApi.getAccount();
      
      return {
        success: true,
        senderEmail: accountInfo.body.email,
        senderName: accountInfo.body.companyName || accountInfo.body.firstName
      };
    } catch (error) {
      console.error('Brevo test error:', error);
      throw new Error('Invalid API key or unable to connect to Brevo');
    }
  }
}

module.exports = new BrevoService();