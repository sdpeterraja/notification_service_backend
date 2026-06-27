// controllers/userController.js
const User = require('../models/User');
const BrevoConfig = require('../models/BrevoConfig');
const Campaign = require('../models/Campaign');
const Template = require('../models/Template');
const Subscriber = require('../models/Subscriber');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');

class UserController {
  constructor() {
    const proto = Object.getPrototypeOf(this);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof this[key] === 'function') {
        this[key] = this[key].bind(this);
      }
    }
  }

  // Get user profile
  async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.userId)
        .select('-password -resetPasswordToken -resetPasswordExpires -twoFactorSecret');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }
      
      // Get Brevo connection status
      const brevoConfig = await BrevoConfig.findOne({ userId: user._id });
      
      // Get user statistics
      const stats = await this.getUserStats(user._id);
      
      res.json({
        success: true,
        data: {
          user,
          brevoConnected: !!brevoConfig && brevoConfig.isConnected,
          stats
        }
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch profile'
      });
    }
  }
  
  // Update user profile
  async updateProfile(req, res) {
    try {
      const { name, email, company, website, phone, timezone, language } = req.body;
      
      const updateData = {};
      if (name) updateData.name = name;
      if (email) updateData.email = email.toLowerCase();
      if (company) updateData.company = company;
      if (website) updateData.website = website;
      if (phone) updateData.phone = phone;
      if (timezone) updateData.timezone = timezone;
      if (language) updateData.language = language;
      
      // Check if email is already taken
      if (email) {
        const existingUser = await User.findOne({ 
          email: email.toLowerCase(),
          _id: { $ne: req.user.userId }
        });
        
        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: 'Email already in use'
          });
        }
      }
      
      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { ...updateData, updatedAt: new Date() },
        { new: true }
      ).select('-password');
      
      res.json({
        success: true,
        data: user,
        message: 'Profile updated successfully'
      });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update profile'
      });
    }
  }
  
  // Update avatar
  async updateAvatar(req, res) {
    try {
      const { avatar } = req.body;
      
      if (!avatar) {
        return res.status(400).json({
          success: false,
          message: 'Avatar image is required'
        });
      }
      
      // Validate base64 image
      const base64Regex = /^data:image\/(png|jpg|jpeg|gif|webp);base64,/;
      if (!base64Regex.test(avatar)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid image format'
        });
      }
      
      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { avatar, updatedAt: new Date() },
        { new: true }
      ).select('-password');
      
      res.json({
        success: true,
        data: { avatar: user.avatar },
        message: 'Avatar updated successfully'
      });
    } catch (error) {
      console.error('Update avatar error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update avatar'
      });
    }
  }
  
  // Remove avatar
  async removeAvatar(req, res) {
    try {
      await User.findByIdAndUpdate(req.user.userId, {
        $unset: { avatar: 1 },
        updatedAt: new Date()
      });
      
      res.json({
        success: true,
        message: 'Avatar removed successfully'
      });
    } catch (error) {
      console.error('Remove avatar error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to remove avatar'
      });
    }
  }
  
  // Update user settings
  async updateSettings(req, res) {
    try {
      const { 
        emailNotifications,
        marketingEmails,
        campaignAlerts,
        weeklyReports,
        twoFactorEnabled,
        sessionTimeout,
        defaultLanguage,
        defaultTimezone 
      } = req.body;
      
      const settings = {
        emailNotifications,
        marketingEmails,
        campaignAlerts,
        weeklyReports,
        twoFactorEnabled,
        sessionTimeout,
        defaultLanguage,
        defaultTimezone
      };
      
      // Remove undefined values
      Object.keys(settings).forEach(key => 
        settings[key] === undefined && delete settings[key]
      );
      
      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { 
          settings,
          updatedAt: new Date()
        },
        { new: true }
      ).select('-password');
      
      res.json({
        success: true,
        data: user.settings,
        message: 'Settings updated successfully'
      });
    } catch (error) {
      console.error('Update settings error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update settings'
      });
    }
  }
  
  // Get user settings
  async getSettings(req, res) {
    try {
      const user = await User.findById(req.user.userId)
        .select('settings preferences notifications');
      
      res.json({
        success: true,
        data: {
          settings: user.settings || {},
          preferences: user.preferences || {},
          notifications: user.notifications || {}
        }
      });
    } catch (error) {
      console.error('Get settings error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch settings'
      });
    }
  }
  
  // Change password
  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password and new password are required'
        });
      }
      
      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters'
        });
      }
      
      const user = await User.findById(req.user.userId);
      
      // Verify current password
      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }
      
      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      user.password = hashedPassword;
      user.passwordChangedAt = new Date();
      await user.save();
      
      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to change password'
      });
    }
  }
  
  // Request password reset
  async requestPasswordReset(req, res) {
    try {
      const { email } = req.body;
      
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        // Don't reveal that user doesn't exist for security
        return res.json({
          success: true,
          message: 'If an account exists, a reset link will be sent'
        });
      }
      
      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExpiry = Date.now() + 3600000; // 1 hour
      
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = resetTokenExpiry;
      await user.save();
      
      // TODO: Send email with reset link
      const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
      
      // In production, send actual email here
      console.log(`Password reset URL: ${resetUrl}`);
      
      res.json({
        success: true,
        message: 'Password reset link sent to your email'
      });
    } catch (error) {
      console.error('Reset request error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process reset request'
      });
    }
  }
  
  // Reset password
  async resetPassword(req, res) {
    try {
      const { token, newPassword } = req.body;
      
      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() }
      });
      
      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token'
        });
      }
      
      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters'
        });
      }
      
      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      user.password = hashedPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      user.passwordChangedAt = new Date();
      await user.save();
      
      res.json({
        success: true,
        message: 'Password reset successfully'
      });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reset password'
      });
    }
  }
  
  // Enable two-factor authentication
  async enable2FA(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      
      // Generate 2FA secret
      const secret = crypto.randomBytes(20).toString('hex');
      user.twoFactorSecret = secret;
      await user.save();
      
      // Generate QR code URL (for Google Authenticator)
      const qrUrl = `otpauth://totp/CampaignFlow:${user.email}?secret=${secret}&issuer=CampaignFlow`;
      
      res.json({
        success: true,
        data: {
          secret,
          qrUrl
        },
        message: '2FA setup initiated'
      });
    } catch (error) {
      console.error('Enable 2FA error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to enable 2FA'
      });
    }
  }
  
  // Verify two-factor authentication
  async verify2FA(req, res) {
    try {
      const { token } = req.body;
      const user = await User.findById(req.user.userId);
      
      // In production, verify TOTP token
      // For now, simple verification
      if (token && token.length === 6) {
        user.twoFactorEnabled = true;
        await user.save();
        
        res.json({
          success: true,
          message: '2FA enabled successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Invalid verification code'
        });
      }
    } catch (error) {
      console.error('Verify 2FA error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to verify 2FA'
      });
    }
  }
  
  // Disable two-factor authentication
  async disable2FA(req, res) {
    try {
      const user = await User.findById(req.user.userId);
      
      user.twoFactorSecret = undefined;
      user.twoFactorEnabled = false;
      await user.save();
      
      res.json({
        success: true,
        message: '2FA disabled successfully'
      });
    } catch (error) {
      console.error('Disable 2FA error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to disable 2FA'
      });
    }
  }
  
  // Update user preferences
  async updatePreferences(req, res) {
    try {
      const { theme, sidebarCollapsed, fontSize, density } = req.body;
      
      const preferences = {
        theme,
        sidebarCollapsed,
        fontSize,
        density
      };
      
      // Remove undefined values
      Object.keys(preferences).forEach(key => 
        preferences[key] === undefined && delete preferences[key]
      );
      
      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { 
          preferences,
          updatedAt: new Date()
        },
        { new: true }
      ).select('preferences');
      
      res.json({
        success: true,
        data: user.preferences,
        message: 'Preferences updated successfully'
      });
    } catch (error) {
      console.error('Update preferences error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update preferences'
      });
    }
  }
  
  // Get user preferences
  async getPreferences(req, res) {
    try {
      const user = await User.findById(req.user.userId).select('preferences');
      
      res.json({
        success: true,
        data: user.preferences || {}
      });
    } catch (error) {
      console.error('Get preferences error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch preferences'
      });
    }
  }
  
  // Get API keys
  async getApiKeys(req, res) {
    try {
      const user = await User.findById(req.user.userId).select('apiKeys');
      
      // Mask API keys for security
      const maskedKeys = (user.apiKeys || []).map(key => ({
        ...key,
        key: key.key.substring(0, 8) + '...' + key.key.substring(key.key.length - 8),
        fullKey: undefined
      }));
      
      res.json({
        success: true,
        data: maskedKeys
      });
    } catch (error) {
      console.error('Get API keys error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch API keys'
      });
    }
  }
  
  // Create API key
  async createApiKey(req, res) {
    try {
      const { name, expiresInDays = 365 } = req.body;
      
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'API key name is required'
        });
      }
      
      const apiKey = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
      
      const newApiKey = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        key: apiKey,
        createdAt: new Date(),
        expiresAt,
        lastUsed: null
      };
      
      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { 
          $push: { apiKeys: newApiKey },
          updatedAt: new Date()
        },
        { new: true }
      ).select('apiKeys');
      
      res.json({
        success: true,
        data: {
          id: newApiKey.id,
          name: newApiKey.name,
          key: apiKey, // Only shown once
          expiresAt: newApiKey.expiresAt
        },
        message: 'API key created successfully'
      });
    } catch (error) {
      console.error('Create API key error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create API key'
      });
    }
  }
  
  // Revoke API key
  async revokeApiKey(req, res) {
    try {
      const { keyId } = req.params;
      
      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { 
          $pull: { apiKeys: { id: keyId } },
          updatedAt: new Date()
        },
        { new: true }
      );
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'API key not found'
        });
      }
      
      res.json({
        success: true,
        message: 'API key revoked successfully'
      });
    } catch (error) {
      console.error('Revoke API key error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to revoke API key'
      });
    }
  }
  
  // Request account deletion
  async requestAccountDeletion(req, res) {
    try {
      const { password } = req.body;
      
      const user = await User.findById(req.user.userId);
      
      // Verify password
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid password'
        });
      }
      
      // Generate deletion token
      const deletionToken = crypto.randomBytes(32).toString('hex');
      user.deletionToken = deletionToken;
      user.deletionRequestedAt = new Date();
      await user.save();
      
      // In production, send email with deletion link
      const deletionUrl = `${process.env.CLIENT_URL}/confirm-deletion?token=${deletionToken}`;
      console.log(`Account deletion URL: ${deletionUrl}`);
      
      res.json({
        success: true,
        message: 'Account deletion request submitted. Check your email for confirmation.'
      });
    } catch (error) {
      console.error('Account deletion request error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to process deletion request'
      });
    }
  }
  
  // Confirm account deletion
  async confirmAccountDeletion(req, res) {
    try {
      const { token } = req.body;
      
      const user = await User.findOne({
        deletionToken: token,
        deletionRequestedAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // 24 hours
      });
      
      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired deletion token'
        });
      }
      
      // Delete all user data
      await Promise.all([
        BrevoConfig.deleteMany({ userId: user._id }),
        Campaign.deleteMany({ userId: user._id }),
        Template.deleteMany({ userId: user._id }),
        Subscriber.deleteMany({ userId: user._id }),
        User.deleteOne({ _id: user._id })
      ]);
      
      res.json({
        success: true,
        message: 'Account deleted successfully'
      });
    } catch (error) {
      console.error('Confirm deletion error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete account'
      });
    }
  }
  
  // Get activity log
  async getActivityLog(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      const user = await User.findById(req.user.userId)
        .select('activityLog')
        .slice('activityLog', [skip, parseInt(limit)]);
      
      const activities = user.activityLog || [];
      const total = user.activityLog ? user.activityLog.length : 0;
      
      res.json({
        success: true,
        data: activities,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Get activity log error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch activity log'
      });
    }
  }
  
  // Get connected services
  async getConnections(req, res) {
    try {
      const brevoConfig = await BrevoConfig.findOne({ userId: req.user.userId });
      
      const connections = {
        brevo: {
          connected: !!brevoConfig && brevoConfig.isConnected,
          email: brevoConfig?.senderEmail || null,
          connectedAt: brevoConfig?.createdAt || null
        }
      };
      
      res.json({
        success: true,
        data: connections
      });
    } catch (error) {
      console.error('Get connections error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch connections'
      });
    }
  }
  
  // Disconnect service
  async disconnectService(req, res) {
    try {
      const { service } = req.params;
      
      if (service === 'brevo') {
        await BrevoConfig.findOneAndDelete({ userId: req.user.userId });
        
        res.json({
          success: true,
          message: 'Brevo disconnected successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Invalid service'
        });
      }
    } catch (error) {
      console.error('Disconnect service error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to disconnect service'
      });
    }
  }
  
  // Update notification settings
  async updateNotificationSettings(req, res) {
    try {
      const { 
        campaignUpdates,
        weeklyDigest,
        productUpdates,
        billingAlerts,
        marketingTips 
      } = req.body;
      
      const notifications = {
        campaignUpdates,
        weeklyDigest,
        productUpdates,
        billingAlerts,
        marketingTips
      };
      
      // Remove undefined values
      Object.keys(notifications).forEach(key => 
        notifications[key] === undefined && delete notifications[key]
      );
      
      const user = await User.findByIdAndUpdate(
        req.user.userId,
        { 
          notifications,
          updatedAt: new Date()
        },
        { new: true }
      ).select('notifications');
      
      res.json({
        success: true,
        data: user.notifications,
        message: 'Notification settings updated'
      });
    } catch (error) {
      console.error('Update notifications error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update notification settings'
      });
    }
  }
  
  // Get notification settings
  async getNotificationSettings(req, res) {
    try {
      const user = await User.findById(req.user.userId).select('notifications');
      
      res.json({
        success: true,
        data: user.notifications || {}
      });
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch notification settings'
      });
    }
  }
  
  // Export user data
  async exportUserData(req, res) {
    try {
      const userId = req.user.userId;
      
      // Fetch all user data
      const [user, brevoConfig, campaigns, templates, subscribers] = await Promise.all([
        User.findById(userId).select('-password -resetPasswordToken -resetPasswordExpires -deletionToken'),
        BrevoConfig.findOne({ userId }),
        Campaign.find({ userId }).lean(),
        Template.find({ userId }).lean(),
        Subscriber.find({ userId }).lean()
      ]);
      
      const exportData = {
        user: {
          email: user.email,
          name: user.name,
          company: user.company,
          createdAt: user.createdAt,
          settings: user.settings,
          preferences: user.preferences
        },
        brevo: brevoConfig ? {
          senderEmail: brevoConfig.senderEmail,
          senderName: brevoConfig.senderName,
          connectedAt: brevoConfig.createdAt,
          isConnected: brevoConfig.isConnected
        } : null,
        campaigns: campaigns.map(c => ({
          name: c.name,
          subject: c.subject,
          status: c.status,
          sentAt: c.sentAt,
          statistics: c.statistics
        })),
        templates: templates.map(t => ({
          name: t.name,
          category: t.category,
          createdAt: t.createdAt,
          usageCount: t.usageCount
        })),
        subscribers: subscribers.map(s => ({
          email: s.email,
          name: s.name,
          status: s.status,
          subscribedAt: s.subscribedAt
        })),
        exportedAt: new Date()
      };
      
      res.json({
        success: true,
        data: exportData,
        message: 'Data exported successfully'
      });
    } catch (error) {
      console.error('Export data error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export user data'
      });
    }
  }
  
  // Helper: Get user statistics
  async getUserStats(userId) {
    const [campaignsCount, templatesCount, subscribersCount, sentEmails] = await Promise.all([
      Campaign.countDocuments({ userId }),
      Template.countDocuments({ userId }),
      Subscriber.countDocuments({ userId }),
      Campaign.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $group: { _id: null, total: { $sum: '$statistics.sentCount' } } }
      ])
    ]);
    
    return {
      totalCampaigns: campaignsCount,
      totalTemplates: templatesCount,
      totalSubscribers: subscribersCount,
      totalEmailsSent: sentEmails[0]?.total || 0
    };
  }
}

module.exports = new UserController();