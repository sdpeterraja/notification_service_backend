// services/brevoService.js
const Brevo = require('@getbrevo/brevo');

class BrevoService {
  constructor() {
    this.apiInstance = null;
  }
  
initialize(apiKey) {
  const defaultClient = Brevo.ApiClient.instance;

  const apiKeyAuth = defaultClient.authentications['api-key'];
  apiKeyAuth.apiKey = apiKey;

  this.apiInstance = new Brevo.TransactionalEmailsApi();
  this.campaignApi = new Brevo.EmailCampaignsApi();
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
  
  async getAccountInfo(apiKey) {
    try {
      const defaultClient = Brevo.ApiClient.instance;

      const apiKeyAuth = defaultClient.authentications['api-key'];
      apiKeyAuth.apiKey = apiKey;

      const accountApi = new Brevo.AccountApi();

      const accountInfo = await accountApi.getAccount();
      return accountInfo;
    } catch (error) {
      console.error('Brevo getAccountInfo error:', error.response?.body || error);
      throw new Error(error.response?.body?.message || 'Failed to fetch Brevo account info');
    }
  }

  async getTransacEmails(apiKey, opts = {}) {
    this.initialize(apiKey);
    try {
      const response = await this.apiInstance.getTransacEmails(opts);
      return response;
    } catch (error) {
      console.error('Brevo getTransacEmails error:', error.response?.body || error);
      throw new Error(error.response?.body?.message || 'Failed to fetch transactional logs from Brevo');
    }
  }

  async getTransacEmailsEvents(apiKey, opts = {}) {
    this.initialize(apiKey);
    try {
      const response = await this.apiInstance.getTransacEmailsEvents(opts);
      return response;
    } catch (error) {
      console.error('Brevo getTransacEmailsEvents error:', error.response?.body || error);
      throw new Error(error.response?.body?.message || 'Failed to fetch transactional events from Brevo');
    }
  }

  async testConnection(apiKey) {
  try {
    const defaultClient = Brevo.ApiClient.instance;

    const apiKeyAuth = defaultClient.authentications['api-key'];
    apiKeyAuth.apiKey = apiKey;

    const accountApi = new Brevo.AccountApi();

    const accountInfo = await accountApi.getAccount();

    console.log('Brevo Account Info:', accountInfo);

    return {
      success: true,
      senderEmail: accountInfo.email,
      senderName:
        accountInfo.companyName ||
        accountInfo.firstName ||
        'Brevo User'
    };
  } catch (error) {
    console.error(
      'Brevo test error:',
      error.response?.body || error
    );

    throw new Error(
      error.response?.body?.message ||
      'Invalid API key or unable to connect to Brevo'
    );
  }
}
}

module.exports = new BrevoService();