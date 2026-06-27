// controllers/listController.js
const List = require('../models/List');
const Subscriber = require('../models/Subscriber');
const BrevoConfig = require('../models/BrevoConfig');
const BrevoService = require('../services/brevoService');
const mongoose = require('mongoose');

class ListController {
  constructor() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }

  // Get all lists
  async getLists(req, res) {
    try {
      const { isActive } = req.query;
      const query = { userId: req.user.userId };
      
      if (isActive !== undefined) {
        query.isActive = isActive === 'true';
      }
      
      const lists = await List.find(query)
        .sort({ createdAt: -1 })
        .populate('welcomeEmailTemplate', 'name');
      
      // Get subscriber count for each list
      const listsWithCount = await Promise.all(lists.map(async (list) => {
        const subscriberCount = await Subscriber.countDocuments({
          userId: req.user.userId,
          lists: list._id.toString(),
          status: 'subscribed'
        });
        
        return {
          ...list.toObject(),
          subscriberCount
        };
      }));
      
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
  
  // Get single list
  async getList(req, res) {
    try {
      const { id } = req.params;
      
      const list = await List.findOne({
        _id: id,
        userId: req.user.userId
      }).populate('welcomeEmailTemplate', 'name subject content');
      
      if (!list) {
        return res.status(404).json({
          success: false,
          message: 'List not found'
        });
      }
      
      // Get subscriber count
      const subscriberCount = await Subscriber.countDocuments({
        userId: req.user.userId,
        lists: id,
        status: 'subscribed'
      });
      
      // Get recent subscribers
      const recentSubscribers = await Subscriber.find({
        userId: req.user.userId,
        lists: id,
        status: 'subscribed'
      })
        .sort({ subscribedAt: -1 })
        .limit(10)
        .select('email name subscribedAt statistics');
      
      res.json({
        success: true,
        data: {
          ...list.toObject(),
          subscriberCount,
          recentSubscribers
        }
      });
    } catch (error) {
      console.error('Get list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch list'
      });
    }
  }
  
  // Create list
  async createList(req, res) {
    try {
      const { name, description, settings, tags } = req.body;
      
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'List name is required'
        });
      }
      
      // Check if list name already exists
      const existingList = await List.findOne({
        userId: req.user.userId,
        name: name.trim()
      });
      
      if (existingList) {
        return res.status(400).json({
          success: false,
          message: 'List with this name already exists'
        });
      }
      
      const list = await List.create({
        userId: req.user.userId,
        name: name.trim(),
        description,
        settings: settings || {},
        tags: tags || [],
        isActive: true
      });
      
      // Create list in Brevo if connected
      await this.syncToBrevo(req.user.userId, list);
      
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
  
  // Update list
  async updateList(req, res) {
    try {
      const { id } = req.params;
      const { name, description, settings, tags, isActive, welcomeEmailTemplate } = req.body;
      
      const list = await List.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!list) {
        return res.status(404).json({
          success: false,
          message: 'List not found'
        });
      }
      
      if (name && name !== list.name) {
        const existingList = await List.findOne({
          userId: req.user.userId,
          name: name.trim(),
          _id: { $ne: id }
        });
        
        if (existingList) {
          return res.status(400).json({
            success: false,
            message: 'List with this name already exists'
          });
        }
        list.name = name.trim();
      }
      
      if (description !== undefined) list.description = description;
      if (settings) list.settings = { ...list.settings, ...settings };
      if (tags) list.tags = tags;
      if (isActive !== undefined) list.isActive = isActive;
      if (welcomeEmailTemplate !== undefined) list.welcomeEmailTemplate = welcomeEmailTemplate;
      
      list.updatedAt = new Date();
      await list.save();
      
      // Log activity
      await this.logActivity(req.user.userId, `Updated list: ${list.name}`, req);
      
      res.json({
        success: true,
        data: list,
        message: 'List updated successfully'
      });
    } catch (error) {
      console.error('Update list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update list'
      });
    }
  }
  
  // Delete list
  async deleteList(req, res) {
    try {
      const { id } = req.params;
      
      const list = await List.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!list) {
        return res.status(404).json({
          success: false,
          message: 'List not found'
        });
      }
      
      // Remove list from all subscribers
      await Subscriber.updateMany(
        { userId: req.user.userId, lists: id },
        { $pull: { lists: id } }
      );
      
      // Delete the list
      await list.deleteOne();
      
      // Log activity
      await this.logActivity(req.user.userId, `Deleted list: ${list.name}`, req);
      
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
  
  // Get list subscribers
  async getListSubscribers(req, res) {
    try {
      const { id } = req.params;
      const { page = 1, limit = 20, status = 'subscribed' } = req.query;
      
      const list = await List.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!list) {
        return res.status(404).json({
          success: false,
          message: 'List not found'
        });
      }
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const query = {
        userId: req.user.userId,
        lists: id,
        status
      };
      
      const [subscribers, total] = await Promise.all([
        Subscriber.find(query)
          .skip(skip)
          .limit(parseInt(limit))
          .sort({ subscribedAt: -1 })
          .select('email name status statistics subscribedAt'),
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
      console.error('Get list subscribers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subscribers'
      });
    }
  }
  
  // Add subscribers to list
  async addSubscribersToList(req, res) {
    try {
      const { id } = req.params;
      const { subscriberIds } = req.body;
      
      if (!subscriberIds || !Array.isArray(subscriberIds) || subscriberIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Subscriber IDs are required'
        });
      }
      
      const list = await List.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!list) {
        return res.status(404).json({
          success: false,
          message: 'List not found'
        });
      }
      
      // Add subscribers to list
      const result = await Subscriber.updateMany(
        {
          _id: { $in: subscriberIds },
          userId: req.user.userId
        },
        {
          $addToSet: { lists: id },
          updatedAt: new Date()
        }
      );
      
      // Log activity
      await this.logActivity(req.user.userId, `Added ${result.modifiedCount} subscribers to list: ${list.name}`, req);
      
      res.json({
        success: true,
        data: { modifiedCount: result.modifiedCount },
        message: `Added ${result.modifiedCount} subscribers to list`
      });
    } catch (error) {
      console.error('Add subscribers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add subscribers to list'
      });
    }
  }
  
  // Remove subscribers from list
  async removeSubscribersFromList(req, res) {
    try {
      const { id } = req.params;
      const { subscriberIds } = req.body;
      
      if (!subscriberIds || !Array.isArray(subscriberIds) || subscriberIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Subscriber IDs are required'
        });
      }
      
      const list = await List.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!list) {
        return res.status(404).json({
          success: false,
          message: 'List not found'
        });
      }
      
      // Remove subscribers from list
      const result = await Subscriber.updateMany(
        {
          _id: { $in: subscriberIds },
          userId: req.user.userId
        },
        {
          $pull: { lists: id },
          updatedAt: new Date()
        }
      );
      
      // Log activity
      await this.logActivity(req.user.userId, `Removed ${result.modifiedCount} subscribers from list: ${list.name}`, req);
      
      res.json({
        success: true,
        data: { modifiedCount: result.modifiedCount },
        message: `Removed ${result.modifiedCount} subscribers from list`
      });
    } catch (error) {
      console.error('Remove subscribers error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove subscribers from list'
      });
    }
  }
  
  // Import list to Brevo
  async importToBrevoList(req, res) {
    try {
      const { id } = req.params;
      
      const list = await List.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!list) {
        return res.status(404).json({
          success: false,
          message: 'List not found'
        });
      }
      
      const brevoConfig = await BrevoConfig.findOne({
        userId: req.user.userId,
        isConnected: true
      });
      
      if (!brevoConfig) {
        return res.status(400).json({
          success: false,
          message: 'Brevo not connected'
        });
      }
      
      // Get all subscribers in this list
      const subscribers = await Subscriber.find({
        userId: req.user.userId,
        lists: id,
        status: 'subscribed'
      });
      
      if (subscribers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No subscribers to import'
        });
      }
      
      // Create list in Brevo if not exists
      let brevoListId = list.brevoListId;
      if (!brevoListId) {
        const brevoList = await BrevoService.createList(brevoConfig.apiKey, list.name);
        brevoListId = brevoList.id;
        list.brevoListId = brevoListId;
        await list.save();
      }
      
      // Prepare contacts
      const contacts = subscribers.map(sub => ({
        email: sub.email,
        name: sub.name,
        attributes: sub.attributes,
        listIds: [brevoListId]
      }));
      
      // Sync to Brevo
      const result = await BrevoService.syncContacts(brevoConfig.apiKey, contacts);
      
      // Log activity
      await this.logActivity(req.user.userId, `Imported ${subscribers.length} subscribers to Brevo list: ${list.name}`, req);
      
      res.json({
        success: true,
        data: {
          imported: subscribers.length,
          brevoListId,
          result
        },
        message: `Imported ${subscribers.length} subscribers to Brevo`
      });
    } catch (error) {
      console.error('Import to Brevo error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to import list to Brevo'
      });
    }
  }
  
  // Get list statistics
  async getListStats(req, res) {
    try {
      const { id } = req.params;
      
      const list = await List.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!list) {
        return res.status(404).json({
          success: false,
          message: 'List not found'
        });
      }
      
      const stats = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(req.user.userId),
            lists: id
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            subscribed: { $sum: { $cond: [{ $eq: ['$status', 'subscribed'] }, 1, 0] } },
            unsubscribed: { $sum: { $cond: [{ $eq: ['$status', 'unsubscribed'] }, 1, 0] } },
            bounced: { $sum: { $cond: [{ $eq: ['$status', 'bounced'] }, 1, 0] } },
            complained: { $sum: { $cond: [{ $eq: ['$status', 'complained'] }, 1, 0] } },
            totalOpens: { $sum: '$statistics.openCount' },
            totalClicks: { $sum: '$statistics.clickCount' },
            avgOpenRate: { $avg: '$statistics.openCount' },
            avgClickRate: { $avg: '$statistics.clickCount' }
          }
        }
      ]);
      
      // Get growth over time
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const growth = await Subscriber.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(req.user.userId),
            lists: id,
            subscribedAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$subscribedAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);
      
      res.json({
        success: true,
        data: {
          listInfo: {
            name: list.name,
            description: list.description,
            createdAt: list.createdAt,
            brevoListId: list.brevoListId
          },
          stats: stats[0] || {
            total: 0,
            subscribed: 0,
            unsubscribed: 0,
            bounced: 0,
            complained: 0,
            totalOpens: 0,
            totalClicks: 0,
            avgOpenRate: 0,
            avgClickRate: 0
          },
          growth
        }
      });
    } catch (error) {
      console.error('Get list stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch list statistics'
      });
    }
  }
  
  // Export list
  async exportList(req, res) {
    try {
      const { id } = req.params;
      const { format = 'json' } = req.query;
      
      const list = await List.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!list) {
        return res.status(404).json({
          success: false,
          message: 'List not found'
        });
      }
      
      const subscribers = await Subscriber.find({
        userId: req.user.userId,
        lists: id,
        status: 'subscribed'
      }).select('email name attributes subscribedAt statistics');
      
      if (format === 'csv') {
        const json2csv = require('json2csv').Parser;
        const fields = ['email', 'name', 'subscribedAt', 'statistics.openCount', 'statistics.clickCount'];
        const parser = new json2csv({ fields });
        const csv = parser.parse(subscribers);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${list.name}_${Date.now()}.csv`);
        return res.send(csv);
      }
      
      res.json({
        success: true,
        data: {
          list: {
            name: list.name,
            description: list.description,
            createdAt: list.createdAt
          },
          subscribers,
          count: subscribers.length
        }
      });
    } catch (error) {
      console.error('Export list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export list'
      });
    }
  }
  
  // Helper: Sync list to Brevo
  async syncToBrevo(userId, list) {
    try {
      const brevoConfig = await BrevoConfig.findOne({ userId, isConnected: true });
      if (!brevoConfig) return;
      
      const brevoList = await BrevoService.createList(brevoConfig.apiKey, list.name);
      list.brevoListId = brevoList.id;
      await list.save();
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

module.exports = new ListController();