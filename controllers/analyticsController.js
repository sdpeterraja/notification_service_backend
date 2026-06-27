// controllers/analyticsController.js
const Campaign = require('../models/Campaign');
const CampaignEvent = require('../models/CampaignEvent');
const Subscriber = require('../models/Subscriber');
const Template = require('../models/Template');
const mongoose = require('mongoose');
const moment = require('moment');

class AnalyticsController {
  constructor() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }

  // Get dashboard analytics
  async getDashboardAnalytics(req, res) {
    try {
      const userId = req.user.userId;
      const { period = '30d' } = req.query;
      
      const dateRange = this.getDateRange(period);
      
      // Parallel queries for dashboard data
      const [
        campaignStats,
        subscriberStats,
        engagementStats,
        recentCampaigns,
        topTemplates,
        hourlyActivity
      ] = await Promise.all([
        this.getCampaignStats(userId, dateRange),
        this.getSubscriberStats(userId, dateRange),
        this.getEngagementStats(userId, dateRange),
        this.getRecentCampaigns(userId, 5),
        this.getTopTemplates(userId, dateRange),
        this.getHourlyActivity(userId, dateRange)
      ]);
      
      res.json({
        success: true,
        data: {
          period,
          dateRange: {
            start: dateRange.start,
            end: dateRange.end
          },
          campaignStats,
          subscriberStats,
          engagementStats,
          recentCampaigns,
          topTemplates,
          hourlyActivity
        }
      });
    } catch (error) {
      console.error('Dashboard analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch dashboard analytics'
      });
    }
  }
  
  // Get overview analytics
  async getOverview(req, res) {
    try {
      const userId = req.user.userId;
      const { period = '30d' } = req.query;
      
      const dateRange = this.getDateRange(period);
      const previousRange = this.getPreviousDateRange(dateRange);
      
      const [
        currentStats,
        previousStats,
        trends,
        topPerforming
      ] = await Promise.all([
        this.getOverviewStats(userId, dateRange),
        this.getOverviewStats(userId, previousRange),
        this.getTrends(userId, dateRange),
        this.getTopPerforming(userId, dateRange)
      ]);
      
      // Calculate growth percentages
      const growth = {
        campaigns: this.calculateGrowth(currentStats.campaigns, previousStats.campaigns),
        emailsSent: this.calculateGrowth(currentStats.emailsSent, previousStats.emailsSent),
        openRate: this.calculateGrowth(currentStats.openRate, previousStats.openRate),
        clickRate: this.calculateGrowth(currentStats.clickRate, previousStats.clickRate),
        subscribers: this.calculateGrowth(currentStats.subscribers, previousStats.subscribers)
      };
      
      res.json({
        success: true,
        data: {
          current: currentStats,
          previous: previousStats,
          growth,
          trends,
          topPerforming
        }
      });
    } catch (error) {
      console.error('Overview analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch overview analytics'
      });
    }
  }
  
  // Get real-time stats
  async getRealtimeStats(req, res) {
    try {
      const userId = req.user.userId;
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const [
        recentOpens,
        recentClicks,
        activeCampaigns,
        recentSubscribers,
        recentBounces
      ] = await Promise.all([
        CampaignEvent.countDocuments({
          type: 'opened',
          timestamp: { $gte: last24Hours }
        }),
        CampaignEvent.countDocuments({
          type: 'clicked',
          timestamp: { $gte: last24Hours }
        }),
        Campaign.countDocuments({
          userId,
          status: 'sending',
          sentAt: { $gte: last24Hours }
        }),
        Subscriber.countDocuments({
          userId,
          subscribedAt: { $gte: last24Hours }
        }),
        CampaignEvent.countDocuments({
          type: 'bounced',
          timestamp: { $gte: last24Hours }
        })
      ]);
      
      // Get current rate (last hour)
      const lastHour = new Date(Date.now() - 60 * 60 * 1000);
      const opensLastHour = await CampaignEvent.countDocuments({
        type: 'opened',
        timestamp: { $gte: lastHour }
      });
      
      res.json({
        success: true,
        data: {
          realtime: {
            opensLastHour: opensLastHour,
            opensPerMinute: Math.round(opensLastHour / 60),
            activeCampaigns
          },
          last24Hours: {
            opens: recentOpens,
            clicks: recentClicks,
            newSubscribers: recentSubscribers,
            bounces: recentBounces
          }
        }
      });
    } catch (error) {
      console.error('Realtime stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch realtime statistics'
      });
    }
  }
  
  // Get campaign analytics
  async getCampaignAnalytics(req, res) {
    try {
      const userId = req.user.userId;
      const { period = '30d', status, type } = req.query;
      
      const dateRange = this.getDateRange(period);
      const query = {
        userId,
        sentAt: { $gte: dateRange.start, $lte: dateRange.end }
      };
      
      if (status) query.status = status;
      if (type) query.type = type;
      
      const campaigns = await Campaign.find(query)
        .sort({ sentAt: -1 })
        .select('name subject status sentAt statistics type');
      
      // Aggregate campaign performance
      const aggregated = {
        total: campaigns.length,
        sent: campaigns.filter(c => c.status === 'sent').length,
        scheduled: campaigns.filter(c => c.status === 'scheduled').length,
        draft: campaigns.filter(c => c.status === 'draft').length,
        failed: campaigns.filter(c => c.status === 'failed').length,
        totalEmailsSent: campaigns.reduce((sum, c) => sum + (c.statistics?.sentCount || 0), 0),
        totalOpens: campaigns.reduce((sum, c) => sum + (c.statistics?.openCount || 0), 0),
        totalClicks: campaigns.reduce((sum, c) => sum + (c.statistics?.clickCount || 0), 0),
        averageOpenRate: 0,
        averageClickRate: 0
      };
      
      if (aggregated.totalEmailsSent > 0) {
        aggregated.averageOpenRate = (aggregated.totalOpens / aggregated.totalEmailsSent) * 100;
        aggregated.averageClickRate = (aggregated.totalClicks / aggregated.totalEmailsSent) * 100;
      }
      
      // Performance by campaign type
      const byType = {};
      campaigns.forEach(campaign => {
        if (!byType[campaign.type]) {
          byType[campaign.type] = {
            count: 0,
            totalOpens: 0,
            totalClicks: 0,
            totalSent: 0
          };
        }
        byType[campaign.type].count++;
        byType[campaign.type].totalSent += campaign.statistics?.sentCount || 0;
        byType[campaign.type].totalOpens += campaign.statistics?.openCount || 0;
        byType[campaign.type].totalClicks += campaign.statistics?.clickCount || 0;
      });
      
      res.json({
        success: true,
        data: {
          summary: aggregated,
          byType,
          campaigns: campaigns.map(c => ({
            id: c._id,
            name: c.name,
            subject: c.subject,
            status: c.status,
            sentAt: c.sentAt,
            type: c.type,
            statistics: c.statistics
          }))
        }
      });
    } catch (error) {
      console.error('Campaign analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch campaign analytics'
      });
    }
  }
  
  // Get single campaign analytics
  async getSingleCampaignAnalytics(req, res) {
    try {
      const { campaignId } = req.params;
      const userId = req.user.userId;
      
      const campaign = await Campaign.findOne({
        _id: campaignId,
        userId
      }).populate('templateId', 'name');
      
      if (!campaign) {
        return res.status(404).json({
          success: false,
          message: 'Campaign not found'
        });
      }
      
      // Get event timeline
      const timeline = await CampaignEvent.aggregate([
        {
          $match: {
            campaignId: new mongoose.Types.ObjectId(campaignId)
          }
        },
        {
          $group: {
            _id: {
              hour: { $hour: '$timestamp' },
              type: '$type'
            },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: '$_id.hour',
            events: {
              $push: {
                type: '$_id.type',
                count: '$count'
              }
            }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      
      // Get top links clicked
      const topLinks = await CampaignEvent.aggregate([
        {
          $match: {
            campaignId: new mongoose.Types.ObjectId(campaignId),
            type: 'clicked',
            'metadata.linkUrl': { $exists: true }
          }
        },
        {
          $group: {
            _id: '$metadata.linkUrl',
            clicks: { $sum: 1 },
            uniqueUsers: { $addToSet: '$email' }
          }
        },
        {
          $project: {
            url: '$_id',
            clicks: '$clicks',
            uniqueClicks: { $size: '$uniqueUsers' },
            _id: 0
          }
        },
        { $sort: { clicks: -1 } },
        { $limit: 10 }
      ]);
      
      // Get device stats
      const deviceStats = await CampaignEvent.aggregate([
        {
          $match: {
            campaignId: new mongoose.Types.ObjectId(campaignId),
            'metadata.device': { $exists: true }
          }
        },
        {
          $group: {
            _id: '$metadata.device',
            count: { $sum: 1 }
          }
        }
      ]);
      
      res.json({
        success: true,
        data: {
          campaign: {
            id: campaign._id,
            name: campaign.name,
            subject: campaign.subject,
            sentAt: campaign.sentAt,
            statistics: campaign.statistics
          },
          timeline,
          topLinks,
          deviceStats,
          performance: campaign.performance
        }
      });
    } catch (error) {
      console.error('Single campaign analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch campaign analytics'
      });
    }
  }
  
  // Compare campaigns
  async compareCampaigns(req, res) {
    try {
      const { campaignIds } = req.query;
      const userId = req.user.userId;
      
      if (!campaignIds) {
        return res.status(400).json({
          success: false,
          message: 'Campaign IDs are required'
        });
      }
      
      const ids = campaignIds.split(',');
      const campaigns = await Campaign.find({
        _id: { $in: ids },
        userId
      }).select('name subject sentAt statistics');
      
      const comparison = campaigns.map(campaign => ({
        id: campaign._id,
        name: campaign.name,
        subject: campaign.subject,
        sentAt: campaign.sentAt,
        sent: campaign.statistics?.sentCount || 0,
        delivered: campaign.statistics?.deliveredCount || 0,
        opens: campaign.statistics?.openCount || 0,
        clicks: campaign.statistics?.clickCount || 0,
        openRate: campaign.statistics?.openRate || 0,
        clickRate: campaign.statistics?.clickRate || 0,
        bounceRate: campaign.statistics?.bounceRate || 0
      }));
      
      res.json({
        success: true,
        data: comparison
      });
    } catch (error) {
      console.error('Compare campaigns error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to compare campaigns'
      });
    }
  }
  
  // Get subscriber growth
  async getSubscriberGrowth(req, res) {
    try {
      const userId = req.user.userId;
      const { days = 30, interval = 'day' } = req.query;
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      
      let groupFormat;
      switch (interval) {
        case 'hour':
          groupFormat = '%Y-%m-%d %H:00';
          break;
        case 'week':
          groupFormat = '%Y-%U';
          break;
        case 'month':
          groupFormat = '%Y-%m';
          break;
        default:
          groupFormat = '%Y-%m-%d';
      }
      
      const growth = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            subscribedAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: groupFormat, date: '$subscribedAt' } },
            newSubscribers: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      
      // Get unsubscribes
      const unsubscribes = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            unsubscribedAt: { $gte: startDate },
            status: 'unsubscribed'
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: groupFormat, date: '$unsubscribedAt' } },
            unsubscribes: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      
      // Combine data
      const combined = {};
      growth.forEach(g => {
        combined[g._id] = { date: g._id, newSubscribers: g.newSubscribers, unsubscribes: 0 };
      });
      unsubscribes.forEach(u => {
        if (combined[u._id]) {
          combined[u._id].unsubscribes = u.unsubscribes;
        } else {
          combined[u._id] = { date: u._id, newSubscribers: 0, unsubscribes: u.unsubscribes };
        }
      });
      
      const result = Object.values(combined);
      
      // Calculate cumulative totals
      let cumulative = 0;
      result.forEach(item => {
        cumulative += item.newSubscribers - item.unsubscribes;
        item.cumulative = cumulative;
      });
      
      res.json({
        success: true,
        data: {
          interval,
          days: parseInt(days),
          growth: result
        }
      });
    } catch (error) {
      console.error('Subscriber growth error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscriber growth'
      });
    }
  }
  
  // Get subscriber engagement
  async getSubscriberEngagement(req, res) {
    try {
      const userId = req.user.userId;
      const { limit = 100 } = req.query;
      
      const engagement = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            status: 'subscribed'
          }
        },
        {
          $project: {
            email: 1,
            name: 1,
            engagementScore: {
              $add: [
                { $multiply: ['$statistics.openCount', 2] },
                { $multiply: ['$statistics.clickCount', 5] }
              ]
            },
            lastActivity: 1,
            statistics: 1
          }
        },
        { $sort: { engagementScore: -1 } },
        { $limit: parseInt(limit) }
      ]);
      
      // Engagement distribution
      const distribution = {
        high: engagement.filter(e => e.engagementScore > 20).length,
        medium: engagement.filter(e => e.engagementScore >= 5 && e.engagementScore <= 20).length,
        low: engagement.filter(e => e.engagementScore > 0 && e.engagementScore < 5).length,
        inactive: engagement.filter(e => e.engagementScore === 0).length
      };
      
      res.json({
        success: true,
        data: {
          topEngaged: engagement,
          distribution,
          total: engagement.length
        }
      });
    } catch (error) {
      console.error('Subscriber engagement error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscriber engagement'
      });
    }
  }
  
  // Get segmentation analytics
  async getSegmentationAnalytics(req, res) {
    try {
      const userId = req.user.userId;
      
      // Get segments (lists)
      const segments = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId)
          }
        },
        {
          $unwind: {
            path: '$lists',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: '$lists',
            count: { $sum: 1 },
            avgOpenRate: { $avg: '$statistics.openCount' },
            avgClickRate: { $avg: '$statistics.clickCount' }
          }
        }
      ]);
      
      // Get tags distribution
      const tags = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId)
          }
        },
        {
          $unwind: {
            path: '$tags',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $group: {
            _id: '$tags',
            count: { $sum: 1 }
          }
        }
      ]);
      
      res.json({
        success: true,
        data: {
          segments: segments.filter(s => s._id),
          tags: tags.filter(t => t._id),
          totalSegments: segments.length,
          totalTags: tags.length
        }
      });
    } catch (error) {
      console.error('Segmentation analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch segmentation analytics'
      });
    }
  }
  
  // Get retention analytics
  async getRetentionAnalytics(req, res) {
    try {
      const userId = req.user.userId;
      const { days = 90 } = req.query;
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      
      // Get cohort data by month
      const cohorts = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            subscribedAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              cohort: { $dateToString: { format: '%Y-%m', date: '$subscribedAt' } },
              month: { $month: '$subscribedAt' },
              year: { $year: '$subscribedAt' }
            },
            count: { $sum: 1 },
            subscribers: { $push: '$$ROOT' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]);
      
      // Calculate retention for each cohort
      const retentionData = [];
      for (const cohort of cohorts) {
        const retention = {
          cohort: cohort._id.cohort,
          total: cohort.count,
          months: []
        };
        
        // Calculate retention at 30, 60, 90 days
        const cohortDate = new Date(cohort._id.year, cohort._id.month - 1);
        
        for (let i = 1; i <= 3; i++) {
          const daysLater = i * 30;
          const dateThreshold = new Date(cohortDate);
          dateThreshold.setDate(dateThreshold.getDate() + daysLater);
          
          const activeCount = await CampaignEvent.aggregate([
            {
              $match: {
                email: { $in: cohort.subscribers.map(s => s.email) },
                timestamp: { $lte: dateThreshold },
                type: { $in: ['opened', 'clicked'] }
              }
            },
            {
              $group: {
                _id: '$email'
              }
            },
            {
              $count: 'active'
            }
          ]);
          
          retention.months.push({
            month: i,
            active: activeCount[0]?.active || 0,
            rate: ((activeCount[0]?.active || 0) / cohort.count) * 100
          });
        }
        
        retentionData.push(retention);
      }
      
      res.json({
        success: true,
        data: {
          cohorts: retentionData,
          averageRetention: this.calculateAverageRetention(retentionData)
        }
      });
    } catch (error) {
      console.error('Retention analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch retention analytics'
      });
    }
  }
  
  // Get email performance
  async getEmailPerformance(req, res) {
    try {
      const userId = req.user.userId;
      const { period = '30d' } = req.query;
      
      const dateRange = this.getDateRange(period);
      
      const performance = await CampaignEvent.aggregate([
        {
          $match: {
            timestamp: { $gte: dateRange.start, $lte: dateRange.end }
          }
        },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            uniqueEmails: { $addToSet: '$email' }
          }
        }
      ]);
      
      const opens = performance.find(p => p._id === 'opened');
      const clicks = performance.find(p => p._id === 'clicked');
      const bounces = performance.find(p => p._id === 'bounced');
      const complaints = performance.find(p => p._id === 'complained');
      
      const totalUniqueOpens = opens?.uniqueEmails.length || 0;
      const totalUniqueClicks = clicks?.uniqueEmails.length || 0;
      
      res.json({
        success: true,
        data: {
          period,
          totals: {
            opens: opens?.count || 0,
            clicks: clicks?.count || 0,
            bounces: bounces?.count || 0,
            complaints: complaints?.count || 0
          },
          unique: {
            opens: totalUniqueOpens,
            clicks: totalUniqueClicks
          }
        }
      });
    } catch (error) {
      console.error('Email performance error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch email performance'
      });
    }
  }
  
  // Get best sending times
  async getBestSendingTimes(req, res) {
    try {
      const userId = req.user.userId;
      const { days = 30 } = req.query;
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      
      // Get open rates by hour of day
      const byHour = await CampaignEvent.aggregate([
        {
          $match: {
            type: 'opened',
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: { hour: { $hour: '$timestamp' } },
            opens: { $sum: 1 },
            uniqueEmails: { $addToSet: '$email' }
          }
        },
        { $sort: { '_id.hour': 1 } }
      ]);
      
      // Get open rates by day of week
      const byDay = await CampaignEvent.aggregate([
        {
          $match: {
            type: 'opened',
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: { dayOfWeek: { $dayOfWeek: '$timestamp' } },
            opens: { $sum: 1 },
            uniqueEmails: { $addToSet: '$email' }
          }
        },
        { $sort: { '_id.dayOfWeek': 1 } }
      ]);
      
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      
      res.json({
        success: true,
        data: {
          byHour: byHour.map(h => ({
            hour: h._id.hour,
            opens: h.opens,
            uniqueOpens: h.uniqueEmails.length
          })),
          byDay: byDay.map(d => ({
            day: dayNames[d._id.dayOfWeek - 1],
            opens: d.opens,
            uniqueOpens: d.uniqueEmails.length
          })),
          bestHour: this.findBestHour(byHour),
          bestDay: this.findBestDay(byDay, dayNames)
        }
      });
    } catch (error) {
      console.error('Best sending times error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch best sending times'
      });
    }
  }
  
  // Get subject line analytics
  async getSubjectLineAnalytics(req, res) {
    try {
      const userId = req.user.userId;
      const { limit = 20 } = req.query;
      
      const campaigns = await Campaign.find({
        userId,
        status: 'sent',
        sentAt: { $exists: true }
      })
        .sort({ sentAt: -1 })
        .limit(parseInt(limit))
        .select('name subject statistics');
      
      const subjectLines = campaigns.map(campaign => ({
        subject: campaign.subject,
        name: campaign.name,
        openRate: campaign.statistics?.openRate || 0,
        clickRate: campaign.statistics?.clickRate || 0,
        sentCount: campaign.statistics?.sentCount || 0
      }));
      
      // Calculate average metrics
      const avgOpenRate = subjectLines.reduce((sum, s) => sum + s.openRate, 0) / subjectLines.length;
      const avgClickRate = subjectLines.reduce((sum, s) => sum + s.clickRate, 0) / subjectLines.length;
      
      // Find best and worst performers
      const best = [...subjectLines].sort((a, b) => b.openRate - a.openRate)[0];
      const worst = [...subjectLines].sort((a, b) => a.openRate - b.openRate)[0];
      
      res.json({
        success: true,
        data: {
          subjectLines,
          averages: {
            openRate: avgOpenRate,
            clickRate: avgClickRate
          },
          bestPerformer: best,
          worstPerformer: worst
        }
      });
    } catch (error) {
      console.error('Subject line analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subject line analytics'
      });
    }
  }
  
  // Get revenue attribution
  async getRevenueAttribution(req, res) {
    try {
      const userId = req.user.userId;
      const { period = '30d' } = req.query;
      
      const dateRange = this.getDateRange(period);
      
      // This would integrate with your e-commerce platform
      // For now, return placeholder data
      const attribution = {
        totalRevenue: 0,
        attributedRevenue: 0,
        campaigns: [],
        conversionRate: 0
      };
      
      res.json({
        success: true,
        data: attribution,
        message: 'Revenue attribution requires e-commerce integration'
      });
    } catch (error) {
      console.error('Revenue attribution error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch revenue attribution'
      });
    }
  }
  
  // Get ROI analytics
  async getROIAnalytics(req, res) {
    try {
      const userId = req.user.userId;
      const { period = '30d' } = req.query;
      
      const dateRange = this.getDateRange(period);
      
      const campaigns = await Campaign.find({
        userId,
        sentAt: { $gte: dateRange.start, $lte: dateRange.end },
        status: 'sent'
      });
      
      const totalSent = campaigns.reduce((sum, c) => sum + (c.statistics?.sentCount || 0), 0);
      const totalOpens = campaigns.reduce((sum, c) => sum + (c.statistics?.openCount || 0), 0);
      const totalClicks = campaigns.reduce((sum, c) => sum + (c.statistics?.clickCount || 0), 0);
      
      // Estimate ROI (assuming average conversion values)
      const estimatedConversions = totalClicks * 0.05; // 5% conversion rate
      const estimatedRevenue = estimatedConversions * 50; // $50 average order value
      const estimatedCost = totalSent * 0.001; // $0.001 per email
      const roi = estimatedCost > 0 ? ((estimatedRevenue - estimatedCost) / estimatedCost) * 100 : 0;
      
      res.json({
        success: true,
        data: {
          period,
          metrics: {
            totalSent,
            totalOpens,
            totalClicks,
            openRate: totalSent > 0 ? (totalOpens / totalSent) * 100 : 0,
            clickRate: totalSent > 0 ? (totalClicks / totalSent) * 100 : 0
          },
          roi: {
            estimatedRevenue,
            estimatedCost,
            roi: Math.round(roi),
            conversionRate: 5
          }
        }
      });
    } catch (error) {
      console.error('ROI analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch ROI analytics'
      });
    }
  }
  
  // Export analytics
  async exportAnalytics(req, res) {
    try {
      const userId = req.user.userId;
      const { period = '30d', format = 'json' } = req.query;
      
      const dateRange = this.getDateRange(period);
      
      const [campaigns, events, subscribers] = await Promise.all([
        Campaign.find({
          userId,
          sentAt: { $gte: dateRange.start, $lte: dateRange.end }
        }).lean(),
        CampaignEvent.find({
          timestamp: { $gte: dateRange.start, $lte: dateRange.end }
        }).lean(),
        Subscriber.find({ userId }).lean()
      ]);
      
      const exportData = {
        period,
        dateRange,
        exportedAt: new Date(),
        summary: {
          campaigns: campaigns.length,
          events: events.length,
          subscribers: subscribers.length
        },
        campaigns,
        events: events.slice(0, 1000), // Limit for performance
        subscribers: subscribers.slice(0, 1000)
      };
      
      if (format === 'csv') {
        const json2csv = require('json2csv').Parser;
        const parser = new json2csv({ fields: ['type', 'email', 'timestamp'] });
        const csv = parser.parse(events.slice(0, 1000));
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=analytics_${Date.now()}.csv`);
        return res.send(csv);
      }
      
      res.json({
        success: true,
        data: exportData
      });
    } catch (error) {
      console.error('Export analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export analytics'
      });
    }
  }
  
  // Get weekly report
  async getWeeklyReport(req, res) {
    try {
      const userId = req.user.userId;
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      
      const report = await this.generateReport(userId, startDate, endDate);
      
      res.json({
        success: true,
        data: report
      });
    } catch (error) {
      console.error('Weekly report error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate weekly report'
      });
    }
  }
  
  // Get monthly report
  async getMonthlyReport(req, res) {
    try {
      const userId = req.user.userId;
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      
      const report = await this.generateReport(userId, startDate, endDate);
      
      res.json({
        success: true,
        data: report
      });
    } catch (error) {
      console.error('Monthly report error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate monthly report'
      });
    }
  }
  
  // Custom query
  async customQuery(req, res) {
    try {
      const { collection, pipeline, limit = 100 } = req.body;
      
      if (!collection || !pipeline) {
        return res.status(400).json({
          success: false,
          message: 'Collection and pipeline are required'
        });
      }
      
      let model;
      switch (collection) {
        case 'campaigns':
          model = Campaign;
          break;
        case 'events':
          model = CampaignEvent;
          break;
        case 'subscribers':
          model = Subscriber;
          break;
        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid collection'
          });
      }
      
      // Add userId filter for security
      const safePipeline = [
        { $match: { userId: new mongoose.Types.ObjectId(req.user.userId) } },
        ...pipeline,
        { $limit: parseInt(limit) }
      ];
      
      const results = await model.aggregate(safePipeline);
      
      res.json({
        success: true,
        data: results
      });
    } catch (error) {
      console.error('Custom query error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to execute custom query'
      });
    }
  }
  
  // ========== Helper Methods ==========
  
  getDateRange(period) {
    const end = new Date();
    const start = new Date();
    
    switch (period) {
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
      case '90d':
        start.setDate(start.getDate() - 90);
        break;
      case '12m':
        start.setMonth(start.getMonth() - 12);
        break;
      default:
        start.setDate(start.getDate() - 30);
    }
    
    return { start, end };
  }
  
  getPreviousDateRange(dateRange) {
    const duration = dateRange.end - dateRange.start;
    return {
      start: new Date(dateRange.start - duration),
      end: dateRange.start
    };
  }
  
  calculateGrowth(current, previous) {
    if (!previous || previous === 0) return 100;
    return ((current - previous) / previous) * 100;
  }
  
  async getCampaignStats(userId, dateRange) {
    const campaigns = await Campaign.find({
      userId,
      sentAt: { $gte: dateRange.start, $lte: dateRange.end }
    });
    
    return {
      total: campaigns.length,
      sent: campaigns.filter(c => c.status === 'sent').length,
      scheduled: campaigns.filter(c => c.status === 'scheduled').length,
      draft: campaigns.filter(c => c.status === 'draft').length,
      failed: campaigns.filter(c => c.status === 'failed').length
    };
  }
  
  async getSubscriberStats(userId, dateRange) {
    return {
      new: await Subscriber.countDocuments({
        userId,
        subscribedAt: { $gte: dateRange.start, $lte: dateRange.end }
      }),
      unsubscribed: await Subscriber.countDocuments({
        userId,
        unsubscribedAt: { $gte: dateRange.start, $lte: dateRange.end }
      }),
      total: await Subscriber.countDocuments({ userId })
    };
  }
  
  async getEngagementStats(userId, dateRange) {
    const events = await CampaignEvent.find({
      timestamp: { $gte: dateRange.start, $lte: dateRange.end }
    });
    
    return {
      opens: events.filter(e => e.type === 'opened').length,
      clicks: events.filter(e => e.type === 'clicked').length,
      bounces: events.filter(e => e.type === 'bounced').length,
      complaints: events.filter(e => e.type === 'complained').length
    };
  }
  
  async getRecentCampaigns(userId, limit) {
    return Campaign.find({ userId, status: 'sent' })
      .sort({ sentAt: -1 })
      .limit(limit)
      .select('name subject sentAt statistics');
  }
  
  async getTopTemplates(userId, dateRange) {
    return Template.find({ userId })
      .sort({ usageCount: -1 })
      .limit(5)
      .select('name usageCount');
  }
  
  async getHourlyActivity(userId, dateRange) {
    return CampaignEvent.aggregate([
      {
        $match: {
          timestamp: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: { hour: { $hour: '$timestamp' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.hour': 1 } }
    ]);
  }
  
  async getOverviewStats(userId, dateRange) {
    const campaigns = await Campaign.find({
      userId,
      sentAt: { $gte: dateRange.start, $lte: dateRange.end }
    });
    
    const totalSent = campaigns.reduce((sum, c) => sum + (c.statistics?.sentCount || 0), 0);
    const totalOpens = campaigns.reduce((sum, c) => sum + (c.statistics?.openCount || 0), 0);
    const totalClicks = campaigns.reduce((sum, c) => sum + (c.statistics?.clickCount || 0), 0);
    
    return {
      campaigns: campaigns.length,
      emailsSent: totalSent,
      openRate: totalSent > 0 ? (totalOpens / totalSent) * 100 : 0,
      clickRate: totalSent > 0 ? (totalClicks / totalSent) * 100 : 0,
      subscribers: await Subscriber.countDocuments({ userId })
    };
  }
  
  async getTrends(userId, dateRange) {
    // Get daily trends for the period
    const dailyTrends = await Campaign.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          sentAt: { $gte: dateRange.start, $lte: dateRange.end }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$sentAt' } },
          campaigns: { $sum: 1 },
          opens: { $sum: '$statistics.openCount' },
          clicks: { $sum: '$statistics.clickCount' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
    
    return dailyTrends;
  }
  
  async getTopPerforming(userId, dateRange) {
    return Campaign.find({
      userId,
      sentAt: { $gte: dateRange.start, $lte: dateRange.end }
    })
      .sort({ 'statistics.openRate': -1 })
      .limit(5)
      .select('name statistics');
  }
  
  findBestHour(hourData) {
    if (hourData.length === 0) return null;
    return hourData.reduce((best, current) => 
      current.opens > best.opens ? current : best
    );
  }
  
  findBestDay(dayData, dayNames) {
    if (dayData.length === 0) return null;
    const best = dayData.reduce((best, current) => 
      current.opens > best.opens ? current : best
    );
    return {
      day: dayNames[best._id.dayOfWeek - 1],
      opens: best.opens
    };
  }
  
  calculateAverageRetention(retentionData) {
    if (retentionData.length === 0) return [];
    
    const avgRetention = [0, 0, 0];
    retentionData.forEach(cohort => {
      cohort.months.forEach((month, index) => {
        avgRetention[index] += month.rate;
      });
    });
    
    return avgRetention.map(avg => avg / retentionData.length);
  }
  
  async generateReport(userId, startDate, endDate) {
    const campaigns = await Campaign.find({
      userId,
      sentAt: { $gte: startDate, $lte: endDate }
    });
    
    const totalSent = campaigns.reduce((sum, c) => sum + (c.statistics?.sentCount || 0), 0);
    const totalOpens = campaigns.reduce((sum, c) => sum + (c.statistics?.openCount || 0), 0);
    const totalClicks = campaigns.reduce((sum, c) => sum + (c.statistics?.clickCount || 0), 0);
    
    return {
      period: {
        start: startDate,
        end: endDate
      },
      summary: {
        campaignsSent: campaigns.length,
        totalEmails: totalSent,
        totalOpens,
        totalClicks,
        averageOpenRate: totalSent > 0 ? (totalOpens / totalSent) * 100 : 0,
        averageClickRate: totalSent > 0 ? (totalClicks / totalSent) * 100 : 0
      },
      topCampaigns: campaigns
        .sort((a, b) => (b.statistics?.openRate || 0) - (a.statistics?.openRate || 0))
        .slice(0, 5)
        .map(c => ({
          name: c.name,
          openRate: c.statistics?.openRate || 0,
          clickRate: c.statistics?.clickRate || 0
        }))
    };
  }
}

module.exports = new AnalyticsController();