// controllers/subscriberController.js
const Subscriber = require('../models/Subscriber');
const List = require('../models/List');
const Segment = require('../models/Segment');
const Campaign = require('../models/Campaign');
const CampaignEvent = require('../models/CampaignEvent');
const BrevoConfig = require('../models/BrevoConfig');
const BrevoService = require('../services/brevoService');
const mongoose = require('mongoose');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const fs = require('fs');
const path = require('path');

class SubscriberController {
  constructor() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }

  // Get all subscribers with filtering and pagination
  async getSubscribers(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        listId,
        segmentId,
        search,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        dateFrom,
        dateTo
      } = req.query;

      const query = { userId: req.user.userId };
      
      // Filter by status
      if (status) {
        query.status = status;
      }
      
      // Filter by list
      if (listId) {
        query.lists = listId;
      }
      
      // Filter by segment
      if (segmentId) {
        const segment = await Segment.findOne({ _id: segmentId, userId: req.user.userId });
        if (segment && segment.conditions) {
          // Apply segment conditions
          Object.assign(query, this.buildSegmentQuery(segment.conditions));
        }
      }
      
      // Search
      if (search) {
        query.$or = [
          { email: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } }
        ];
      }
      
      // Date range
      if (dateFrom || dateTo) {
        query.createdAt = {};
        if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
        if (dateTo) query.createdAt.$lte = new Date(dateTo);
      }
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
      
      const [subscribers, total] = await Promise.all([
        Subscriber.find(query)
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .populate('lists', 'name'),
        Subscriber.countDocuments(query)
      ]);
      
      res.json({
        success: true,
        data: subscribers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get subscribers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscribers'
      });
    }
  }
  
  // Get subscriber statistics
  async getSubscriberStats(req, res) {
    try {
      const userId = req.user.userId;
      
      const stats = await Subscriber.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            subscribed: { $sum: { $cond: [{ $eq: ['$status', 'subscribed'] }, 1, 0] } },
            unsubscribed: { $sum: { $cond: [{ $eq: ['$status', 'unsubscribed'] }, 1, 0] } },
            bounced: { $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 1, 0] } },
            complained: { $sum: { $cond: [{ $eq: ['$status', 'complained'] }, 1, 0] } },
            totalOpens: { $sum: '$statistics.openCount' },
            totalClicks: { $sum: '$statistics.clickCount' }
          }
        }
      ]);
      
      // Get recent growth (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentGrowth = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      
      // Get list distribution
      const lists = await List.find({ userId, isActive: true });
      const listDistribution = await Promise.all(lists.map(async (list) => ({
        name: list.name,
        count: await Subscriber.countDocuments({ userId, lists: list._id, status: 'subscribed' })
      })));
      
      res.json({
        success: true,
        data: {
          summary: stats[0] || {
            total: 0,
            subscribed: 0,
            unsubscribed: 0,
            bounced: 0,
            complained: 0,
            totalOpens: 0,
            totalClicks: 0
          },
          recentGrowth,
          listDistribution
        }
      });
    } catch (error) {
      console.error('Get subscriber stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch statistics'
      });
    }
  }
  
  // Get single subscriber
  async getSubscriber(req, res) {
    try {
      const { id } = req.params;
      
      const subscriber = await Subscriber.findOne({
        _id: id,
        userId: req.user.userId
      }).populate('lists');
      
      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: 'Subscriber not found'
        });
      }
      
      // Get campaign history for this subscriber
      const campaignHistory = await CampaignEvent.find({
        email: subscriber.email,
        type: { $in: ['opened', 'clicked', 'bounced', 'complained'] }
      })
        .populate('campaignId', 'name subject')
        .sort({ timestamp: -1 })
        .limit(50);
      
      res.json({
        success: true,
        data: {
          subscriber,
          campaignHistory
        }
      });
    } catch (error) {
      console.error('Get subscriber error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscriber'
      });
    }
  }
  
  // Create subscriber
  async createSubscriber(req, res) {
    try {
      const { email, name, attributes, lists } = req.body;
      
      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }
      
      // Check if subscriber already exists
      const existing = await Subscriber.findOne({
        email: email.toLowerCase(),
        userId: req.user.userId
      });
      
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Subscriber already exists'
        });
      }
      
      const subscriber = await Subscriber.create({
        userId: req.user.userId,
        email: email.toLowerCase(),
        name,
        attributes: attributes || {},
        lists: lists || [],
        status: 'subscribed',
        subscribedAt: new Date()
      });
      
      // Sync with Brevo if connected
      await this.syncToBrevo(req.user.userId, subscriber);
      
      // Log activity
      await this.logActivity(req.user.userId, `Added subscriber: ${email}`, req);
      
      res.status(201).json({
        success: true,
        data: subscriber,
        message: 'Subscriber added successfully'
      });
    } catch (error) {
      console.error('Create subscriber error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create subscriber'
      });
    }
  }
  
  // Update subscriber
  async updateSubscriber(req, res) {
    try {
      const { id } = req.params;
      const { name, attributes, lists, preferences } = req.body;
      
      const subscriber = await Subscriber.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: 'Subscriber not found'
        });
      }
      
      if (name) subscriber.name = name;
      if (attributes) subscriber.attributes = { ...subscriber.attributes, ...attributes };
      if (lists) subscriber.lists = lists;
      if (preferences) subscriber.preferences = { ...subscriber.preferences, ...preferences };
      
      subscriber.updatedAt = new Date();
      await subscriber.save();
      
      // Sync with Brevo
      await this.syncToBrevo(req.user.userId, subscriber);
      
      // Log activity
      await this.logActivity(req.user.userId, `Updated subscriber: ${subscriber.email}`, req);
      
      res.json({
        success: true,
        data: subscriber,
        message: 'Subscriber updated successfully'
      });
    } catch (error) {
      console.error('Update subscriber error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update subscriber'
      });
    }
  }
  
  // Delete subscriber
  async deleteSubscriber(req, res) {
    try {
      const { id } = req.params;
      
      const subscriber = await Subscriber.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: 'Subscriber not found'
        });
      }
      
      await subscriber.deleteOne();
      
      // Log activity
      await this.logActivity(req.user.userId, `Deleted subscriber: ${subscriber.email}`, req);
      
      res.json({
        success: true,
        message: 'Subscriber deleted successfully'
      });
    } catch (error) {
      console.error('Delete subscriber error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete subscriber'
      });
    }
  }
  
  // Bulk import subscribers
  async bulkImport(req, res) {
    try {
      const { subscribers } = req.body;
      
      if (!subscribers || !Array.isArray(subscribers) || subscribers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Subscribers array is required'
        });
      }
      
      let imported = 0;
      let updated = 0;
      let failed = 0;
      
      for (const sub of subscribers) {
        try {
          if (!sub.email) {
            failed++;
            continue;
          }
          
          const existing = await Subscriber.findOne({
            email: sub.email.toLowerCase(),
            userId: req.user.userId
          });
          
          if (existing) {
            // Update existing
            if (sub.name) existing.name = sub.name;
            if (sub.attributes) existing.attributes = { ...existing.attributes, ...sub.attributes };
            if (sub.lists) existing.lists = [...new Set([...existing.lists, ...sub.lists])];
            existing.updatedAt = new Date();
            await existing.save();
            updated++;
          } else {
            // Create new
            await Subscriber.create({
              userId: req.user.userId,
              email: sub.email.toLowerCase(),
              name: sub.name,
              attributes: sub.attributes || {},
              lists: sub.lists || [],
              status: 'subscribed',
              subscribedAt: new Date()
            });
            imported++;
          }
        } catch (error) {
          failed++;
          console.error(`Failed to import ${sub.email}:`, error);
        }
      }
      
      // Log activity
      await this.logActivity(req.user.userId, `Bulk import: ${imported} new, ${updated} updated, ${failed} failed`, req);
      
      res.json({
        success: true,
        data: { imported, updated, failed, total: subscribers.length },
        message: `Imported ${imported} new subscribers, updated ${updated}, failed ${failed}`
      });
    } catch (error) {
      console.error('Bulk import error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to bulk import subscribers'
      });
    }
  }
  
  // Bulk delete subscribers
  async bulkDelete(req, res) {
    try {
      const { subscriberIds, condition } = req.body;
      
      let query = { userId: req.user.userId };
      
      if (subscriberIds && subscriberIds.length > 0) {
        query._id = { $in: subscriberIds };
      } else if (condition) {
        // Apply conditions (e.g., status, date range, etc.)
        if (condition.status) query.status = condition.status;
        if (condition.unsubscribedBefore) {
          query.unsubscribedAt = { $lt: new Date(condition.unsubscribedBefore) };
        }
        if (condition.noActivitySince) {
          query.lastActivity = { $lt: new Date(condition.noActivitySince) };
        }
      } else {
        return res.status(400).json({
          success: false,
          message: 'Either subscriberIds or condition is required'
        });
      }
      
      const result = await Subscriber.deleteMany(query);
      
      // Log activity
      await this.logActivity(req.user.userId, `Bulk deleted ${result.deletedCount} subscribers`, req);
      
      res.json({
        success: true,
        data: { deletedCount: result.deletedCount },
        message: `Deleted ${result.deletedCount} subscribers`
      });
    } catch (error) {
      console.error('Bulk delete error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to bulk delete subscribers'
      });
    }
  }
  
  // Bulk update subscribers
  async bulkUpdate(req, res) {
    try {
      const { subscriberIds, updateData } = req.body;
      
      if (!subscriberIds || subscriberIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Subscriber IDs are required'
        });
      }
      
      if (!updateData || Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Update data is required'
        });
      }
      
      const result = await Subscriber.updateMany(
        { _id: { $in: subscriberIds }, userId: req.user.userId },
        { $set: { ...updateData, updatedAt: new Date() } }
      );
      
      // Log activity
      await this.logActivity(req.user.userId, `Bulk updated ${result.modifiedCount} subscribers`, req);
      
      res.json({
        success: true,
        data: { modifiedCount: result.modifiedCount },
        message: `Updated ${result.modifiedCount} subscribers`
      });
    } catch (error) {
      console.error('Bulk update error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to bulk update subscribers'
      });
    }
  }
  
  // Unsubscribe subscriber
  async unsubscribe(req, res) {
    try {
      const { id } = req.params;
      
      const subscriber = await Subscriber.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: 'Subscriber not found'
        });
      }
      
      subscriber.status = 'unsubscribed';
      subscriber.unsubscribedAt = new Date();
      await subscriber.save();
      
      // Sync with Brevo
      await this.syncToBrevo(req.user.userId, subscriber);
      
      // Log activity
      await this.logActivity(req.user.userId, `Unsubscribed: ${subscriber.email}`, req);
      
      res.json({
        success: true,
        message: 'Subscriber unsubscribed successfully'
      });
    } catch (error) {
      console.error('Unsubscribe error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to unsubscribe subscriber'
      });
    }
  }
  
  // Resubscribe subscriber
  async resubscribe(req, res) {
    try {
      const { id } = req.params;
      
      const subscriber = await Subscriber.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: 'Subscriber not found'
        });
      }
      
      subscriber.status = 'subscribed';
      subscriber.unsubscribedAt = undefined;
      await subscriber.save();
      
      // Sync with Brevo
      await this.syncToBrevo(req.user.userId, subscriber);
      
      // Log activity
      await this.logActivity(req.user.userId, `Resubscribed: ${subscriber.email}`, req);
      
      res.json({
        success: true,
        message: 'Subscriber resubscribed successfully'
      });
    } catch (error) {
      console.error('Resubscribe error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to resubscribe subscriber'
      });
    }
  }
  
  // Add subscriber to list
  async addToList(req, res) {
    try {
      const { id } = req.params;
      const { listId } = req.body;
      
      if (!listId) {
        return res.status(400).json({
          success: false,
          message: 'List ID is required'
        });
      }
      
      const subscriber = await Subscriber.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: 'Subscriber not found'
        });
      }
      
      if (!subscriber.lists.includes(listId)) {
        subscriber.lists.push(listId);
        await subscriber.save();
      }
      
      res.json({
        success: true,
        message: 'Subscriber added to list successfully'
      });
    } catch (error) {
      console.error('Add to list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add subscriber to list'
      });
    }
  }
  
  // Remove subscriber from list
  async removeFromList(req, res) {
    try {
      const { id } = req.params;
      const { listId } = req.body;
      
      if (!listId) {
        return res.status(400).json({
          success: false,
          message: 'List ID is required'
        });
      }
      
      const subscriber = await Subscriber.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: 'Subscriber not found'
        });
      }
      
      subscriber.lists = subscriber.lists.filter(l => l.toString() !== listId);
      await subscriber.save();
      
      res.json({
        success: true,
        message: 'Subscriber removed from list successfully'
      });
    } catch (error) {
      console.error('Remove from list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove subscriber from list'
      });
    }
  }
  
  // Get all lists
  async getAllLists(req, res) {
    try {
      const lists = await List.find({
        userId: req.user.userId,
        isActive: true
      }).sort({ createdAt: -1 });
      
      // Get subscriber count for each list
      const listsWithCount = await Promise.all(lists.map(async (list) => ({
        ...list.toObject(),
        subscriberCount: await Subscriber.countDocuments({
          userId: req.user.userId,
          lists: list._id,
          status: 'subscribed'
        })
      })));
      
      res.json({
        success: true,
        data: listsWithCount
      });
    } catch (error) {
      console.error('Get lists error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch lists'
      });
    }
  }
  
  // Create list
  async createList(req, res) {
    try {
      const { name, description, settings } = req.body;
      
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'List name is required'
        });
      }
      
      const list = await List.create({
        userId: req.user.userId,
        name,
        description,
        settings: settings || {},
        isActive: true
      });
      
      // Log activity
      await this.logActivity(req.user.userId, `Created list: ${name}`, req);
      
      res.status(201).json({
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
  
  // Get subscribers by list
  async getSubscribersByList(req, res) {
    try {
      const { listId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const [subscribers, total] = await Promise.all([
        Subscriber.find({
          userId: req.user.userId,
          lists: listId,
          status: 'subscribed'
        })
          .skip(skip)
          .limit(parseInt(limit))
          .sort({ createdAt: -1 }),
        Subscriber.countDocuments({
          userId: req.user.userId,
          lists: listId,
          status: 'subscribed'
        })
      ]);
      
      res.json({
        success: true,
        data: subscribers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get subscribers by list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscribers'
      });
    }
  }
  
  // Delete list
  async deleteList(req, res) {
    try {
      const { listId } = req.params;
      
      // Remove list from all subscribers
      await Subscriber.updateMany(
        { userId: req.user.userId, lists: listId },
        { $pull: { lists: listId } }
      );
      
      // Delete the list
      await List.deleteOne({ _id: listId, userId: req.user.userId });
      
      // Log activity
      await this.logActivity(req.user.userId, `Deleted list: ${listId}`, req);
      
      res.json({
        success: true,
        message: 'List deleted successfully'
      });
    } catch (error) {
      console.error('Delete list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete list'
      });
    }
  }
  
  // Create segment
  async createSegment(req, res) {
    try {
      const { name, description, conditions } = req.body;
      
      if (!name || !conditions) {
        return res.status(400).json({
          success: false,
          message: 'Name and conditions are required'
        });
      }
      
      const segment = await Segment.create({
        userId: req.user.userId,
        name,
        description,
        conditions,
        subscriberCount: 0
      });
      
      // Calculate initial subscriber count
      const query = this.buildSegmentQuery(conditions);
      query.userId = req.user.userId;
      const count = await Subscriber.countDocuments(query);
      segment.subscriberCount = count;
      await segment.save();
      
      // Log activity
      await this.logActivity(req.user.userId, `Created segment: ${name}`, req);
      
      res.status(201).json({
        success: true,
        data: segment,
        message: 'Segment created successfully'
      });
    } catch (error) {
      console.error('Create segment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create segment'
      });
    }
  }
  
  // Get all segments
  async getSegments(req, res) {
    try {
      const segments = await Segment.find({
        userId: req.user.userId
      }).sort({ createdAt: -1 });
      
      res.json({
        success: true,
        data: segments
      });
    } catch (error) {
      console.error('Get segments error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch segments'
      });
    }
  }
  
  // Get subscribers by segment
  async getSubscribersBySegment(req, res) {
    try {
      const { segmentId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      
      const segment = await Segment.findOne({
        _id: segmentId,
        userId: req.user.userId
      });
      
      if (!segment) {
        return res.status(404).json({
          success: false,
          message: 'Segment not found'
        });
      }
      
      const query = this.buildSegmentQuery(segment.conditions);
      query.userId = req.user.userId;
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const [subscribers, total] = await Promise.all([
        Subscriber.find(query)
          .skip(skip)
          .limit(parseInt(limit))
          .sort({ createdAt: -1 }),
        Subscriber.countDocuments(query)
      ]);
      
      res.json({
        success: true,
        data: subscribers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get subscribers by segment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscribers'
      });
    }
  }
  
  // Update segment
  async updateSegment(req, res) {
    try {
      const { segmentId } = req.params;
      const { name, description, conditions } = req.body;
      
      const segment = await Segment.findOne({
        _id: segmentId,
        userId: req.user.userId
      });
      
      if (!segment) {
        return res.status(404).json({
          success: false,
          message: 'Segment not found'
        });
      }
      
      if (name) segment.name = name;
      if (description) segment.description = description;
      if (conditions) {
        segment.conditions = conditions;
        
        // Recalculate subscriber count
        const query = this.buildSegmentQuery(conditions);
        query.userId = req.user.userId;
        segment.subscriberCount = await Subscriber.countDocuments(query);
      }
      
      await segment.save();
      
      res.json({
        success: true,
        data: segment,
        message: 'Segment updated successfully'
      });
    } catch (error) {
      console.error('Update segment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update segment'
      });
    }
  }
  
  // Delete segment
  async deleteSegment(req, res) {
    try {
      const { segmentId } = req.params;
      
      await Segment.deleteOne({
        _id: segmentId,
        userId: req.user.userId
      });
      
      res.json({
        success: true,
        message: 'Segment deleted successfully'
      });
    } catch (error) {
      console.error('Delete segment error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete segment'
      });
    }
  }
  
  // Get analytics overview
  async getAnalytics(req, res) {
    try {
      const { period = '30d' } = req.query;
      
      let startDate = new Date();
      switch (period) {
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(startDate.getDate() - 90);
          break;
        default:
          startDate.setDate(startDate.getDate() - 30);
      }
      
      const analytics = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(req.user.userId),
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            newSubscribers: { $sum: 1 },
            unsubscribes: {
              $sum: {
                $cond: [
                  { $and: [
                    { $eq: ['$status', 'unsubscribed'] },
                    { $gte: ['$unsubscribedAt', startDate] }
                  ]},
                  1, 0
                ]
              }
            },
            totalOpens: { $sum: '$statistics.openCount' },
            totalClicks: { $sum: '$statistics.clickCount' }
          }
        }
      ]);
      
      // Get top engaged subscribers
      const topEngaged = await Subscriber.find({
        userId: req.user.userId,
        status: 'subscribed'
      })
        .sort({ 'statistics.openCount': -1 })
        .limit(10)
        .select('email name statistics');
      
      res.json({
        success: true,
        data: {
          period,
          summary: analytics[0] || {
            newSubscribers: 0,
            unsubscribes: 0,
            totalOpens: 0,
            totalClicks: 0
          },
          topEngaged
        }
      });
    } catch (error) {
      console.error('Get analytics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch analytics'
      });
    }
  }
  
  // Get growth data
  async getGrowthData(req, res) {
    try {
      const { days = 30 } = req.query;
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(days));
      
      const growthData = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(req.user.userId),
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            newSubscribers: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      
      res.json({
        success: true,
        data: growthData
      });
    } catch (error) {
      console.error('Get growth data error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch growth data'
      });
    }
  }
  
  // Get engagement data
  async getEngagementData(req, res) {
    try {
      const engagementData = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(req.user.userId),
            status: 'subscribed'
          }
        },
        {
          $group: {
            _id: null,
            avgOpens: { $avg: '$statistics.openCount' },
            avgClicks: { $avg: '$statistics.clickCount' },
            totalEngaged: {
              $sum: {
                $cond: [{ $gt: ['$statistics.openCount', 0] }, 1, 0]
              }
            }
          }
        }
      ]);
      
      res.json({
        success: true,
        data: engagementData[0] || {
          avgOpens: 0,
          avgClicks: 0,
          totalEngaged: 0
        }
      });
    } catch (error) {
      console.error('Get engagement data error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch engagement data'
      });
    }
  }
  
  // Add tags to subscriber
  async addTags(req, res) {
    try {
      const { id } = req.params;
      const { tags } = req.body;
      
      if (!tags || !Array.isArray(tags)) {
        return res.status(400).json({
          success: false,
          message: 'Tags array is required'
        });
      }
      
      const subscriber = await Subscriber.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: 'Subscriber not found'
        });
      }
      
      subscriber.tags = [...new Set([...(subscriber.tags || []), ...tags])];
      await subscriber.save();
      
      res.json({
        success: true,
        data: subscriber.tags,
        message: 'Tags added successfully'
      });
    } catch (error) {
      console.error('Add tags error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add tags'
      });
    }
  }
  
  // Remove tags from subscriber
  async removeTags(req, res) {
    try {
      const { id } = req.params;
      const { tags } = req.body;
      
      if (!tags || !Array.isArray(tags)) {
        return res.status(400).json({
          success: false,
          message: 'Tags array is required'
        });
      }
      
      const subscriber = await Subscriber.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!subscriber) {
        return res.status(404).json({
          success: false,
          message: 'Subscriber not found'
        });
      }
      
      subscriber.tags = (subscriber.tags || []).filter(t => !tags.includes(t));
      await subscriber.save();
      
      res.json({
        success: true,
        data: subscriber.tags,
        message: 'Tags removed successfully'
      });
    } catch (error) {
      console.error('Remove tags error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove tags'
      });
    }
  }
  
  // Search subscribers
  async searchSubscribers(req, res) {
    try {
      const { query } = req.params;
      const { limit = 20 } = req.query;
      
      const subscribers = await Subscriber.find({
        userId: req.user.userId,
        $or: [
          { email: { $regex: query, $options: 'i' } },
          { name: { $regex: query, $options: 'i' } }
        ]
      })
        .limit(parseInt(limit))
        .select('email name status createdAt');
      
      res.json({
        success: true,
        data: subscribers
      });
    } catch (error) {
      console.error('Search subscribers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to search subscribers'
      });
    }
  }
  
  // Export subscribers to JSON
  async exportSubscribers(req, res) {
    try {
      const { format = 'json', listId, status } = req.query;
      
      const query = { userId: req.user.userId };
      if (listId) query.lists = listId;
      if (status) query.status = status;
      
      const subscribers = await Subscriber.find(query)
        .select('-__v')
        .lean();
      
      if (format === 'csv') {
        const fields = ['email', 'name', 'status', 'subscribedAt', 'statistics.openCount', 'statistics.clickCount'];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(subscribers);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=subscribers_${Date.now()}.csv`);
        return res.send(csv);
      }
      
      res.json({
        success: true,
        data: subscribers,
        count: subscribers.length
      });
    } catch (error) {
      console.error('Export subscribers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export subscribers'
      });
    }
  }
  
  // Import from CSV
  async importFromCSV(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'CSV file is required'
        });
      }
      
      const results = [];
      const filePath = req.file.path;
      
      // Parse CSV file
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (data) => results.push(data))
          .on('end', resolve)
          .on('error', reject);
      });
      
      // Import subscribers
      let imported = 0;
      let failed = 0;
      
      for (const row of results) {
        try {
          if (!row.email) continue;
          
          const existing = await Subscriber.findOne({
            email: row.email.toLowerCase(),
            userId: req.user.userId
          });
          
          if (!existing) {
            await Subscriber.create({
              userId: req.user.userId,
              email: row.email.toLowerCase(),
              name: row.name,
              attributes: row.attributes ? JSON.parse(row.attributes) : {},
              status: 'subscribed',
              subscribedAt: new Date()
            });
            imported++;
          }
        } catch (error) {
          failed++;
        }
      }
      
      // Clean up temp file
      fs.unlinkSync(filePath);
      
      res.json({
        success: true,
        data: { imported, failed, total: results.length },
        message: `Imported ${imported} subscribers`
      });
    } catch (error) {
      console.error('Import CSV error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to import CSV'
      });
    }
  }
  
  // Export to CSV
  async exportToCSV(req, res) {
    try {
      const subscribers = await Subscriber.find({
        userId: req.user.userId,
        status: 'subscribed'
      }).select('email name createdAt');
      
      const fields = ['email', 'name', 'createdAt'];
      const json2csvParser = new Parser({ fields });
      const csv = json2csvParser.parse(subscribers);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=subscribers_${Date.now()}.csv`);
      res.send(csv);
    } catch (error) {
      console.error('Export CSV error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export CSV'
      });
    }
  }
  
  // Helper: Build MongoDB query from segment conditions
  buildSegmentQuery(conditions) {
    const query = {};
    
    if (!conditions) return query;

    // Handle array of conditions from front-end builder
    if (Array.isArray(conditions)) {
      const andConditions = [];
      for (const cond of conditions) {
        const condQuery = {};
        const field = cond.field;
        const operator = cond.operator;
        const value = cond.value;

        if (field === 'Email Opened') {
          if (operator === 'at least once') {
            condQuery['statistics.openCount'] = { $gte: 1 };
          }
          if (value && !isNaN(value)) {
            const dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - parseInt(value));
            condQuery['statistics.lastOpenAt'] = { $gte: dateLimit };
          }
        } else if (field === 'Email Clicked') {
          if (operator === 'at least once') {
            condQuery['statistics.clickCount'] = { $gte: 1 };
          }
          if (value && !isNaN(value)) {
            const dateLimit = new Date();
            dateLimit.setDate(dateLimit.getDate() - parseInt(value));
            condQuery['statistics.lastClickAt'] = { $gte: dateLimit };
          }
        } else if (field === 'Tag') {
          if (operator === 'is' || operator === 'contains') {
            condQuery.tags = { $in: [value] };
          } else if (operator === 'is not') {
            condQuery.tags = { $nin: [value] };
          }
        } else if (field === 'Status') {
          if (operator === 'is') {
            condQuery.status = value.toLowerCase();
          } else if (operator === 'is not') {
            condQuery.status = { $ne: value.toLowerCase() };
          }
        }
        
        if (Object.keys(condQuery).length > 0) {
          andConditions.push(condQuery);
        }
      }
      
      if (andConditions.length > 0) {
        query.$and = andConditions;
      }
      return query;
    }
    
    if (conditions.status) {
      query.status = conditions.status;
    }
    
    if (conditions.dateRange) {
      query.createdAt = {};
      if (conditions.dateRange.from) query.createdAt.$gte = new Date(conditions.dateRange.from);
      if (conditions.dateRange.to) query.createdAt.$lte = new Date(conditions.dateRange.to);
    }
    
    if (conditions.activity) {
      query['statistics.openCount'] = { $gte: conditions.activity.minOpens || 0 };
    }
    
    if (conditions.tags && conditions.tags.length > 0) {
      query.tags = { $in: conditions.tags };
    }
    
    return query;
  }
  
  // Helper: Sync subscriber to Brevo
  async syncToBrevo(userId, subscriber) {
    try {
      const brevoConfig = await BrevoConfig.findOne({ userId, isConnected: true });
      if (!brevoConfig) return;
      
      const contact = {
        email: subscriber.email,
        name: subscriber.name,
        attributes: subscriber.attributes,
        listIds: subscriber.lists
      };
      
      await BrevoService.syncContacts(brevoConfig.apiKey, [contact]);
      
      subscriber.syncedToBrevo = true;
      subscriber.lastSyncedAt = new Date();
      await subscriber.save();
    } catch (error) {
      console.error('Sync to Brevo error:', error);
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

module.exports = new SubscriberController();