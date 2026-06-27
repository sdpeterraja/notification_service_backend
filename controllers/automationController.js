// controllers/automationController.js
const Automation = require('../models/Automation');

class AutomationController {
  constructor() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }
  
  // Get all automations for user
  async getAutomations(req, res) {
    try {
      const automations = await Automation.find({
        userId: req.user.userId
      }).sort({ createdAt: -1 });

      res.json({
        success: true,
        data: automations
      });
    } catch (error) {
      console.error('Get automations error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch automations'
      });
    }
  }

  // Get single automation
  async getAutomation(req, res) {
    try {
      const { id } = req.params;
      const automation = await Automation.findOne({
        _id: id,
        userId: req.user.userId
      });

      if (!automation) {
        return res.status(404).json({
          success: false,
          message: 'Automation not found'
        });
      }

      res.json({
        success: true,
        data: automation
      });
    } catch (error) {
      console.error('Get automation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch automation'
      });
    }
  }

  // Create automation
  async createAutomation(req, res) {
    try {
      const { name, description, status, nodes } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Automation name is required'
        });
      }

      const automation = await Automation.create({
        userId: req.user.userId,
        name,
        description,
        status: status || 'Draft',
        nodes: nodes || []
      });

      res.status(201).json({
        success: true,
        data: automation,
        message: 'Automation created successfully'
      });
    } catch (error) {
      console.error('Create automation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create automation'
      });
    }
  }

  // Update automation
  async updateAutomation(req, res) {
    try {
      const { id } = req.params;
      const { name, description, status, nodes } = req.body;

      const automation = await Automation.findOne({
        _id: id,
        userId: req.user.userId
      });

      if (!automation) {
        return res.status(404).json({
          success: false,
          message: 'Automation not found'
        });
      }

      if (name !== undefined) automation.name = name;
      if (description !== undefined) automation.description = description;
      if (status !== undefined) automation.status = status;
      if (nodes !== undefined) automation.nodes = nodes;

      await automation.save();

      res.json({
        success: true,
        data: automation,
        message: 'Automation updated successfully'
      });
    } catch (error) {
      console.error('Update automation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update automation'
      });
    }
  }

  // Delete automation
  async deleteAutomation(req, res) {
    try {
      const { id } = req.params;

      const result = await Automation.deleteOne({
        _id: id,
        userId: req.user.userId
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'Automation not found'
        });
      }

      res.json({
        success: true,
        message: 'Automation deleted successfully'
      });
    } catch (error) {
      console.error('Delete automation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete automation'
      });
    }
  }
}

module.exports = new AutomationController();
