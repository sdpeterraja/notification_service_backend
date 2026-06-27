// controllers/templateController.js
const Template = require('../models/Template');
const Campaign = require('../models/Campaign');

class TemplateController {
  constructor() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }

  // Get all templates
  async getTemplates(req, res) {
    try {
      const { category, isFavorite, search, page = 1, limit = 20 } = req.query;
      const query = { userId: req.user.userId, isActive: true };
      
      if (category) query.category = category;
      if (isFavorite === 'true') query.isFavorite = true;
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { subject: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ];
      }
      
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const [templates, total] = await Promise.all([
        Template.find(query)
          .sort({ isFavorite: -1, createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Template.countDocuments(query)
      ]);
      
      res.json({
        success: true,
        data: templates,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get templates error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch templates'
      });
    }
  }
  
  // Get single template
  async getTemplate(req, res) {
    try {
      const { id } = req.params;
      
      const template = await Template.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!template) {
        return res.status(404).json({
          success: false,
          message: 'Template not found'
        });
      }
      
      res.json({
        success: true,
        data: template
      });
    } catch (error) {
      console.error('Get template error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch template'
      });
    }
  }
  
  // Create template
  async createTemplate(req, res) {
    try {
      const { name, subject, content, previewImage, category, tags, jsonState } = req.body;
      
      if (!name || !subject || !content) {
        return res.status(400).json({
          success: false,
          message: 'Name, subject, and content are required'
        });
      }
      
      const template = await Template.create({
        userId: req.user.userId,
        name,
        subject,
        content,
        previewImage,
        category,
        tags: tags || [],
        jsonState
      });
      
      res.status(201).json({
        success: true,
        data: template
      });
    } catch (error) {
      console.error('Create template error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create template'
      });
    }
  }
  
  // Update template
  async updateTemplate(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      const template = await Template.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!template) {
        return res.status(404).json({
          success: false,
          message: 'Template not found'
        });
      }
      
      // Check if template is used in any campaign
      const campaignsUsing = await Campaign.countDocuments({
        templateId: id,
        status: { $in: ['sending', 'sent'] }
      });
      
      if (campaignsUsing > 0 && updateData.content) {
        // Create new version instead of updating
        updateData.version = template.version + 1;
        const newTemplate = await Template.create({
          ...template.toObject(),
          ...updateData,
          _id: undefined,
          createdAt: undefined,
          usageCount: 0
        });
        
        return res.json({
          success: true,
          data: newTemplate,
          message: 'New version created due to active campaigns'
        });
      }
      
      Object.assign(template, updateData);
      await template.save();
      
      res.json({
        success: true,
        data: template
      });
    } catch (error) {
      console.error('Update template error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update template'
      });
    }
  }
  
  // Delete template
  async deleteTemplate(req, res) {
    try {
      const { id } = req.params;
      
      const template = await Template.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!template) {
        return res.status(404).json({
          success: false,
          message: 'Template not found'
        });
      }
      
      // Check if template is used in any campaign
      const campaignsUsing = await Campaign.countDocuments({
        templateId: id,
        status: { $ne: 'draft' }
      });
      
      if (campaignsUsing > 0) {
        // Soft delete instead
        template.isActive = false;
        await template.save();
        
        return res.json({
          success: true,
          message: 'Template archived successfully'
        });
      }
      
      await template.deleteOne();
      
      res.json({
        success: true,
        message: 'Template deleted successfully'
      });
    } catch (error) {
      console.error('Delete template error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete template'
      });
    }
  }
  
  // Toggle favorite
  async toggleFavorite(req, res) {
    try {
      const { id } = req.params;
      
      const template = await Template.findOne({
        _id: id,
        userId: req.user.userId
      });
      
      if (!template) {
        return res.status(404).json({
          success: false,
          message: 'Template not found'
        });
      }
      
      template.isFavorite = !template.isFavorite;
      await template.save();
      
      res.json({
        success: true,
        data: { isFavorite: template.isFavorite }
      });
    } catch (error) {
      console.error('Toggle favorite error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update favorite status'
      });
    }
  }
  
  // Increment usage count
  async incrementUsage(req, res) {
    try {
      const { id } = req.params;
      
      await Template.findByIdAndUpdate(id, {
        $inc: { usageCount: 1 }
      });
      
      res.json({
        success: true,
        message: 'Usage count updated'
      });
    } catch (error) {
      console.error('Increment usage error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update usage count'
      });
    }
  }
}

module.exports = new TemplateController();