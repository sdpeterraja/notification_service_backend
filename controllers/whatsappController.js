const mongoose = require('mongoose');
const WhatsAppConfig = require('../models/WhatsAppConfig');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const WhatsAppCampaign = require('../models/WhatsAppCampaign');
const WhatsAppWebhookLog = require('../models/WhatsAppWebhookLog');
const Automation = require('../models/Automation');

// ----------------------------------------------------
// FACEBOOK GRAPH / WHATSAPP CLOUD API REQUEST PROXIES
// ----------------------------------------------------

async function registerMetaTemplate(config, template) {
  const { wabaId, accessToken, apiVersion } = config;
  if (!wabaId || !accessToken) {
    throw new Error("Missing Meta verification credentials. Map WABA ID and Token in Settings.");
  }

  const components = [
    {
      type: "BODY",
      text: template.bodyText
    }
  ];

  if (template.headerType === "TEXT" && template.headerText) {
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: template.headerText
    });
  } else if (template.headerType && template.headerType !== "NONE") {
    components.push({
      type: "HEADER",
      format: template.headerType
    });
  }

  if (template.footerText) {
    components.push({
      type: "FOOTER",
      text: template.footerText
    });
  }

  if (template.buttons && template.buttons.length > 0) {
    const metaButtons = template.buttons.map((btn) => {
      if (btn.type === "QUICK_REPLY") {
        return { type: "QUICK_REPLY", text: btn.text };
      } else if (btn.type === "URL") {
        return { type: "URL", text: btn.text, url: btn.urlValue || "https://example.com" };
      } else if (btn.type === "PHONE") {
        return { type: "PHONE_NUMBER", text: btn.text, phone_number: btn.phoneValue || "+15551234567" };
      }
    }).filter(Boolean);
    components.push({
      type: "BUTTONS",
      buttons: metaButtons
    });
  }

  const url = `https://graph.facebook.com/${apiVersion || "v20.0"}/${wabaId}/message_templates`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: template.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      category: template.category,
      language: template.language || "en_US",
      components: components
    })
  });

  const resData = await response.json();
  if (!response.ok) {
    throw new Error(resData.error?.message || `Meta Approval Registration Error (${response.status})`);
  }
  return resData;
}

async function sendRealWhatsAppMessage(config, recipient, template) {
  const { phoneId, accessToken, apiVersion } = config;
  if (!phoneId || !accessToken) {
    throw new Error("Missing Meta developer credentials link. Configure Phone Number ID and System Token.");
  }

  const parameters = [];
  const paramCount = (template.bodyText.match(/\{\{\d+\}\}/g) || []).length;
  
  // Re-map recipient variables
  const variablesMap = recipient.variables || {};
  const variablesObj = variablesMap instanceof Map ? Object.fromEntries(variablesMap) : variablesMap;

  for (let i = 1; i <= paramCount; i++) {
    const valObj = variablesObj[`{{${i}}}`] || "";
    parameters.push({
      type: "text",
      text: valObj
    });
  }

  const payload = {
    messaging_product: "whatsapp",
    to: recipient.phone.replace(/[^0-9]/g, ""), // Meta Cloud API expects E.164 without the leading '+'
    type: "template",
    template: {
      name: template.name,
      language: {
        code: template.language || "en_US"
      },
      components: []
    }
  };

  // 1. Handle Header Parameters (Text variables or Media attachment URL)
  if (template.headerType === "TEXT" && template.headerText) {
    const headerParamCount = (template.headerText.match(/\{\{\d+\}\}/g) || []).length;
    if (headerParamCount > 0) {
      const headerParams = [];
      for (let i = 1; i <= headerParamCount; i++) {
        // Look for custom header variable prefix or default fallback
        const valObj = variablesObj[`header_{{${i}}}`] || variablesObj[`{{${i}}}`] || "";
        headerParams.push({
          type: "text",
          text: valObj
        });
      }
      payload.template.components.push({
        type: "header",
        parameters: headerParams
      });
    }
  } else if (template.headerType && template.headerType !== "NONE") {
    // Media Header (IMAGE, DOCUMENT, VIDEO)
    // Extract media URL from recipient variables, falling back to a template URL or fallback image
    const mediaUrl = variablesObj['header_media_url'] || variablesObj['media_url'] || template.headerMediaUrl || "https://example.com/fallback.png";
    const mediaTypeLower = template.headerType.toLowerCase(); // e.g. "image", "document", "video"
    payload.template.components.push({
      type: "header",
      parameters: [
        {
          type: mediaTypeLower,
          [mediaTypeLower]: {
            link: mediaUrl
          }
        }
      ]
    });
  }

  // 2. Handle Body Parameters
  if (parameters.length > 0) {
    payload.template.components.push({
      type: "body",
      parameters: parameters
    });
  }

  const url = `https://graph.facebook.com/${apiVersion || "v20.0"}/${phoneId}/messages`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const resData = await response.json();
  if (!response.ok) {
    throw new Error(resData.error?.message || `Meta API Error (${response.status})`);
  }
  return resData;
}

// ----------------------------------------------------
// WEBHOOK PROGRESS AND RECEIPT SIMULATORS
// ----------------------------------------------------

async function executeAutomationsForWhatsAppReply(userId, fromPhone, textContent) {
  try {
    const activeAutomations = await Automation.find({
      userId,
      status: 'Active'
    });

    const runsLogs = [];

    for (const automation of activeAutomations) {
      const nodes = automation.nodes || [];
      if (nodes.length === 0) continue;

      // Trigger is the first node
      const triggerNode = nodes[0];
      const isWhatsAppReplyTrigger = 
        triggerNode.type === "trigger" && 
        (triggerNode.title?.toLowerCase().includes("whatsapp reply") || 
         triggerNode.iconName === "MessageSquare" ||
         triggerNode.id?.includes("whatsapp_reply"));

      if (!isWhatsAppReplyTrigger) continue;

      // Evaluate trigger filter keyword
      const triggerKeyword = triggerNode.keyword?.trim().toLowerCase();
      const cleanContent = textContent.trim().toLowerCase();
      
      if (triggerKeyword && !cleanContent.includes(triggerKeyword)) {
        continue;
      }

      console.log(`🚀 Triggering Automation "${automation.name}" for ${fromPhone}`);
      runsLogs.push(`[Automation: ${automation.name}] Triggered for phone ${fromPhone}`);

      // Track state of execution
      let currentIdx = 1;
      let nextNodeId = nodes[1]?.id;
      const executionTrace = [];
      executionTrace.push(`Triggered automation flow: "${automation.name}"`);

      while (currentIdx < nodes.length) {
        const node = nodes.find(n => n.id === nextNodeId) || nodes[currentIdx];
        if (!node) break;

        if (node.type === "action") {
          if (node.iconName === "Smartphone" || node.title?.toLowerCase().includes("whatsapp")) {
            const templateName = node.subtitle || "default_promo_template";
            executionTrace.push(`Action: Send WhatsApp template "${templateName}"`);
          } else if (node.iconName === "Mail" || node.title?.toLowerCase().includes("email")) {
            const templateName = node.subtitle || "Welcome Series Email";
            executionTrace.push(`Action: Send Email "${templateName}"`);
          } else {
            executionTrace.push(`Action: Execute step "${node.title}"`);
          }
          currentIdx = nodes.indexOf(node) + 1;
          nextNodeId = nodes[currentIdx]?.id;
        } else if (node.type === "condition" || node.title?.toLowerCase().includes("wait")) {
          executionTrace.push(`Delay: Wait/Delay for "${node.subtitle}"`);
          currentIdx = nodes.indexOf(node) + 1;
          nextNodeId = nodes[currentIdx]?.id;
        } else if (node.type === "split" || node.iconName === "Split") {
          const splitKeyword = node.keyword?.trim().toLowerCase() || "yes";
          const hasKeyword = cleanContent.includes(splitKeyword);
          executionTrace.push(`Split check: Does message contain keyword "${splitKeyword}"? Result: ${hasKeyword ? "YES" : "NO"}`);
          executionTrace.push(`Branch: ${hasKeyword ? "YES" : "NO"} path taken`);
          break;
        } else {
          break;
        }
      }

      // Write logs to database
      for (let i = 0; i < executionTrace.length; i++) {
        const stepDesc = executionTrace[i];
        await WhatsAppWebhookLog.create({
          userId,
          id: `weblog_${Date.now()}_${Math.random().toString(36).substr(2, 5)}_${i}`,
          timestamp: new Date(Date.now() + i * 50).toISOString(),
          campaignName: automation.name,
          phone: fromPhone,
          status: "run_step",
          failureReason: stepDesc,
          rawPayload: JSON.stringify({ stepIndex: i, trace: stepDesc }, null, 2)
        });
      }

      runsLogs.push(...executionTrace);
    }

    return runsLogs;
  } catch (error) {
    console.error("Error executing automations for reply:", error);
    return [];
  }
}

async function handleStatusInline(userId, body) {
  const entries = body.entry || [];
  let processedItems = 0;
  const triggeredRuns = [];

  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field === "messages" || change.field === "simulated_messages") {
        const value = change.value || {};
        
        // Process statuses (delivery receipts)
        const statuses = value.statuses || [];
        for (const statusObj of statuses) {
          const statusName = statusObj.status;
          const recipientPhone = statusObj.recipient_id;
          const errors = statusObj.errors || [];
          const failureReason = errors.length > 0 ? errors[0].message : undefined;

          // Find recipient across running campaigns for this user
          const campaign = await WhatsAppCampaign.findOne({
            userId,
            "recipients.phone": recipientPhone,
            status: { $in: ["RUNNING", "SCHEDULED", "COMPLETED"] }
          }).sort({ createdAt: -1 });

          if (campaign) {
            const matchedRecipient = campaign.recipients.find(r => r.phone === recipientPhone && r.status !== "PENDING");
            if (matchedRecipient) {
              const statusOrder = { PENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };
              const currentStatus = matchedRecipient.status;
              const newStatusUpper = statusName.toUpperCase();

              if (
                statusName === "failed" ||
                (newStatusUpper in statusOrder && statusOrder[newStatusUpper] > statusOrder[currentStatus])
              ) {
                matchedRecipient.status = newStatusUpper;
                const nowStr = new Date().toISOString();
                if (statusName === "sent") matchedRecipient.sentAt = nowStr;
                else if (statusName === "delivered") matchedRecipient.deliveredAt = nowStr;
                else if (statusName === "read") matchedRecipient.readAt = nowStr;

                if (statusName === "failed" && failureReason) {
                  matchedRecipient.failureReason = failureReason;
                }

                // Recalculate metrics
                campaign.sentCount = campaign.recipients.filter(r => ["SENT", "DELIVERED", "READ"].includes(r.status)).length;
                campaign.deliveredCount = campaign.recipients.filter(r => ["DELIVERED", "READ"].includes(r.status)).length;
                campaign.readCount = campaign.recipients.filter(r => r.status === "READ").length;
                campaign.failedCount = campaign.recipients.filter(r => r.status === "FAILED").length;

                const totalProcessed = campaign.sentCount + campaign.failedCount;
                if (totalProcessed >= campaign.totalRecipients) {
                  campaign.status = "COMPLETED";
                }

                await campaign.save();
              }
            }
          }

          // Write log entry
          await WhatsAppWebhookLog.create({
            userId,
            id: `weblog_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date().toISOString(),
            campaignId: campaign ? campaign.id : undefined,
            campaignName: campaign ? campaign.name : "Simulated Event",
            phone: recipientPhone,
            status: statusName,
            failureReason,
            rawPayload: JSON.stringify(body, null, 2)
          });
          processedItems++;
        }

        // Process message replies from customers
        const messages = value.messages || [];
        for (const msgObj of messages) {
          const fromPhone = msgObj.from;
          const msgType = msgObj.type;
          let msgText = "";

          if (msgType === "text" && msgObj.text) {
            msgText = msgObj.text.body || "";
          } else if (msgType === "button" && msgObj.button) {
            msgText = msgObj.button.text || "";
          }

          if (msgText) {
            console.log(`💬 WhatsApp reply received from ${fromPhone}: "${msgText}"`);

            // Write inbound message log entry
            await WhatsAppWebhookLog.create({
              userId,
              id: `weblog_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              timestamp: new Date().toISOString(),
              campaignName: "Customer Message Reply",
              phone: fromPhone,
              status: "received",
              failureReason: msgText, // Save message content in failureReason for display
              rawPayload: JSON.stringify(body, null, 2)
            });

            // Trigger matching active automations
            const runs = await executeAutomationsForWhatsAppReply(userId, fromPhone, msgText);
            triggeredRuns.push(...runs);
            processedItems++;
          }
        }
      }
    }
  }

  // Keep logs bounded to last 200 items per user
  const excessLogs = await WhatsAppWebhookLog.find({ userId }).sort({ timestamp: -1 }).skip(200);
  if (excessLogs.length > 0) {
    const idsToDelete = excessLogs.map(l => l._id);
    await WhatsAppWebhookLog.deleteMany({ _id: { $in: idsToDelete } });
  }

  return { processedItems, triggeredRuns };
}

// ----------------------------------------------------
// SCHEDULER TICK ENGINE RUNNER
// ----------------------------------------------------

let schedulerLocked = false;

async function runSchedulerCycle() {
  if (schedulerLocked) return;
  schedulerLocked = true;

  try {
    const now = new Date();
    // Query active scheduled/running campaigns
    const activeCampaigns = await WhatsAppCampaign.find({
      status: { $in: ["SCHEDULED", "RUNNING"] },
      scheduledTime: { $lte: now.toISOString() }
    });

    for (const campaign of activeCampaigns) {
      const { userId } = campaign;
      const config = await WhatsAppConfig.findOne({ userId }) || {};

      if (campaign.status === "SCHEDULED") {
        campaign.status = "RUNNING";
        await campaign.save();
      }

      const template = await WhatsAppTemplate.findOne({ userId, id: campaign.templateId });
      if (!template) {
        campaign.status = "FAILED";
        await campaign.save();
        console.error(`Scheduler Error: WhatsApp Template ${campaign.templateId} not found for campaign ${campaign.name}`);
        continue;
      }

      // Filter subdocuments pending sending
      const pendingRecipients = campaign.recipients.filter(r => r.status === "PENDING");
      
      if (pendingRecipients.length === 0) {
        const processedCount = campaign.sentCount + campaign.failedCount;
        if (processedCount >= campaign.totalRecipients) {
          campaign.status = "COMPLETED";
          await campaign.save();
        }
        continue;
      }

      // Throttle limits to 3 per scheduler tick
      const dispatchLimit = Math.min(3, pendingRecipients.length);
      const toSend = pendingRecipients.slice(0, dispatchLimit);

      for (const recipient of toSend) {
        try {
          await sendRealWhatsAppMessage(config, recipient, template);
          
          recipient.status = "SENT";
          recipient.sentAt = new Date().toISOString();
          campaign.sentCount++;
        } catch (apiErr) {
          console.error(`Meta Dispatch Error for ${recipient.phone}:`, apiErr.message);
          recipient.status = "FAILED";
          recipient.failureReason = apiErr.message;
          campaign.failedCount++;
        }
      }

      // Save changes back to DB
      await campaign.save();
    }
  } catch (error) {
    console.error("WhatsApp Scheduler Cycle encountered error:", error);
  } finally {
    schedulerLocked = false;
  }
}

// ----------------------------------------------------
// CONTROLLER ROUTE ENDPOINT OBJECT
// ----------------------------------------------------

const whatsappController = {
  // Config Endpoints
  async getConfig(req, res) {
    try {
      let config = await WhatsAppConfig.findOne({ userId: req.user.userId });
      if (!config) {
        // Create initial default config
        config = await WhatsAppConfig.create({
          userId: req.user.userId,
          accessToken: "",
          phoneId: "",
          wabaId: "",
          verifyToken: "whatsapp_campaign_verify_token_2026",
          apiVersion: "v20.0"
        });
      }
      res.json(config);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async saveConfig(req, res) {
    try {
      const config = await WhatsAppConfig.findOneAndUpdate(
        { userId: req.user.userId },
        { $set: req.body },
        { upsert: true, new: true }
      );
      res.json({ success: true, config });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Template Endpoints
  async getTemplates(req, res) {
    try {
      const templates = await WhatsAppTemplate.find({ userId: req.user.userId }).sort({ createdAt: -1 });
      res.json(templates);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async createTemplate(req, res) {
    try {
      const config = await WhatsAppConfig.findOne({ userId: req.user.userId });
      if (!config || !config.accessToken || !config.wabaId) {
        return res.status(400).json({ error: "Missing WhatsApp credentials. Please configure your Meta credentials in Settings before creating templates." });
      }
      
      const freshTemplate = {
        userId: req.user.userId,
        id: `tpl_${Date.now()}`,
        createdAt: new Date().toISOString(),
        status: "PENDING_APPROVAL",
        ...req.body
      };

      freshTemplate.name = freshTemplate.name.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_");

      try {
        await registerMetaTemplate(config, freshTemplate);
      } catch (metaErr) {
        return res.status(400).json({ error: `Facebook Graph API rejected template: ${metaErr.message}` });
      }

      const template = await WhatsAppTemplate.create(freshTemplate);
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async deleteTemplate(req, res) {
    try {
      const result = await WhatsAppTemplate.deleteOne({ userId: req.user.userId, id: req.params.id });
      if (result.deletedCount > 0) {
        return res.json({ success: true });
      }
      res.status(404).json({ error: "Template not found" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Campaign Endpoints
  async getCampaigns(req, res) {
    try {
      const campaigns = await WhatsAppCampaign.find({ userId: req.user.userId }).sort({ createdAt: -1 });
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async createCampaign(req, res) {
    try {
      const { name, templateId, scheduledTime, recipients } = req.body;
      if (!name || !templateId || !recipients || !Array.isArray(recipients)) {
        return res.status(400).json({ error: "Missing required Campaign components" });
      }

      const newCampaign = await WhatsAppCampaign.create({
        userId: req.user.userId,
        id: `camp_${Date.now()}`,
        name,
        templateId,
        scheduledTime: scheduledTime ? new Date(scheduledTime).toISOString() : new Date().toISOString(),
        status: "SCHEDULED",
        totalRecipients: recipients.length,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
        failedCount: 0,
        createdAt: new Date().toISOString(),
        recipients: recipients.map((r, idx) => ({
          id: `rec_${Date.now()}_${idx}`,
          name: r.name || "Recipient",
          phone: r.phone,
          variables: r.variables || {},
          status: "PENDING"
        }))
      });

      res.status(201).json(newCampaign);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async deleteCampaign(req, res) {
    try {
      const result = await WhatsAppCampaign.deleteOne({ userId: req.user.userId, id: req.params.id });
      if (result.deletedCount > 0) {
        return res.json({ success: true });
      }
      res.status(404).json({ error: "Campaign not found" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async patchCampaign(req, res) {
    try {
      const { status } = req.body;
      const campaign = await WhatsAppCampaign.findOneAndUpdate(
        { userId: req.user.userId, id: req.params.id },
        { status },
        { new: true }
      );
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      res.json(campaign);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Webhook Logs Endpoints
  async getWebhookLogs(req, res) {
    try {
      const logs = await WhatsAppWebhookLog.find({ userId: req.user.userId }).sort({ timestamp: -1 });
      res.json(logs);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  async deleteWebhookLogs(req, res) {
    try {
      await WhatsAppWebhookLog.deleteMany({ userId: req.user.userId });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  },

  // Public webhook challenge verification
  async getWebhook(req, res) {
    try {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode && token) {
        if (mode === "subscribe") {
          // Check verify token matching any user's configuration
          const config = await WhatsAppConfig.findOne({ verifyToken: token });
          if (config || token === "whatsapp_campaign_verify_token_2026") {
            console.log("Meta Webhook verified successfully!");
            return res.status(200).send(challenge);
          } else {
            console.warn("Webhook verification failed: token mismatch.");
            return res.sendStatus(403);
          }
        }
      }
      return res.status(400).send("Bad Request: Missing hub parameter verification details.");
    } catch (error) {
      res.status(500).send("Internal server error during challenge verification");
    }
  },

  // Public webhook receiver status events ingestion
  async postWebhook(req, res) {
    try {
      const body = req.body;
      if (body.object === "whatsapp_business_account" || body.object === "whatsapp_simulated") {
        const wabaId = body.entry?.[0]?.id;
        
        // Find configuration mapping to identify user ID
        let userId = null;
        if (wabaId) {
          const config = await WhatsAppConfig.findOne({ wabaId });
          if (config) userId = config.userId;
        }

        // Fallback 1: search for active campaign recipient phone number
        if (!userId) {
          const recipientPhone = body.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.recipient_id;
          if (recipientPhone) {
            const recentCampaign = await WhatsAppCampaign.findOne({
              "recipients.phone": recipientPhone,
              status: { $in: ["RUNNING", "SCHEDULED", "COMPLETED"] }
            }).sort({ createdAt: -1 });
            if (recentCampaign) userId = recentCampaign.userId;
          }
        }

        // Fallback 2: search for message reply phone number
        if (!userId) {
          const incomingMsg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
          const incomingPhone = incomingMsg?.from;
          if (incomingPhone) {
            const recentCampaign = await WhatsAppCampaign.findOne({
              "recipients.phone": incomingPhone
            }).sort({ createdAt: -1 });
            if (recentCampaign) userId = recentCampaign.userId;
          }
        }

        // Fallback 3: find any config
        if (!userId) {
          const anyConfig = await WhatsAppConfig.findOne({});
          if (anyConfig) userId = anyConfig.userId;
        }

        if (userId) {
          const result = await handleStatusInline(userId, body);
          return res.status(200).json({ success: true, processed: true, ...result });
        }
      }
      return res.status(200).json({ success: true, warning: "unhandled object event type" });
    } catch (error) {
      console.error("Error processing Webhook status:", error);
      return res.status(500).json({ success: false, error: "Internal processing error" });
    }
  },

  async simulateReply(req, res) {
    try {
      const { phone, message } = req.body;
      const userId = req.user.userId;

      if (!phone || !message) {
        return res.status(400).json({ success: false, error: "Phone and message body are required." });
      }

      const mockBody = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "simulated_waba_id",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  contacts: [
                    {
                      profile: { name: "Simulated Customer" },
                      wa_id: phone.replace(/[^0-9]/g, "")
                    }
                  ],
                  messages: [
                    {
                      from: phone.replace(/[^0-9]/g, ""),
                      id: `msg_${Date.now()}`,
                      timestamp: Math.floor(Date.now() / 1000).toString(),
                      text: { body: message },
                      type: "text"
                    }
                  ]
                },
                field: "messages"
              }
            ]
          }
        ]
      };

      const result = await handleStatusInline(userId, mockBody);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Simulate reply error:", error);
      res.status(550).json({ success: false, error: error.message });
    }
  },

  async simulateStatus(req, res) {
    try {
      const { phone, status, campaignId } = req.body;
      const userId = req.user.userId;

      if (!phone || !status) {
        return res.status(400).json({ success: false, error: "Phone and status are required." });
      }

      const mockBody = {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "simulated_waba_id",
            changes: [
              {
                value: {
                  messaging_product: "whatsapp",
                  statuses: [
                    {
                      id: `status_${Date.now()}`,
                      recipient_id: phone.replace(/[^0-9]/g, ""),
                      status: status.toLowerCase(),
                      timestamp: Math.floor(Date.now() / 1000).toString()
                    }
                  ]
                },
                field: "messages"
              }
            ]
          }
        ]
      };

      const result = await handleStatusInline(userId, mockBody);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Simulate status error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
};

// Export the ticks engine runner as a separate property
whatsappController.runSchedulerCycle = runSchedulerCycle;

module.exports = whatsappController;
