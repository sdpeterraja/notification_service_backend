// server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');
const connectDB = require('./config/database');

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// Middleware
app.use(helmet()); // Security headers
// app.use(cors({
//   origin: process.env.CLIENT_URL || 'http://localhost:5173',
//   credentials: true
// }));

// server.js - CORS configuration
const corsOptions = {
  origin: [
    'http://localhost:5173',  // Vite default
    'http://localhost:3000',   // React default
    'http://localhost:5000',   // Backend itself
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080',
    'http://localhost:8080'
  ],
  credentials: true,            // Allow cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Allow-Origin',
    'referer'
  ],
  exposedHeaders: ['Authorization'],
  optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev')); // Logging



// Routes
// In server.js, update your routes section:
// server.js - Fix the routes section

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const brevoRoutes = require('./routes/brevoRoutes');
const templateRoutes = require('./routes/templateRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const subscriberRoutes = require('./routes/subscriberRoutes');
const listRoutes = require('./routes/listRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const templateSyncRoutes = require('./routes/templateSyncRoutes');
const automationRoutes = require('./routes/automationRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const whatsappController = require('./controllers/whatsappController');
const aiRoutes = require('./routes/aiRoutes');
const canvaRoutes = require('./routes/canvaRoutes');

// Routes - CORRECTED
app.use('/api/auth', authRoutes);     // This gives: /api/auth/login, /api/auth/register
app.use('/api/user', authRoutes);     // This gives: /api/user/login, /api/user/register (ADD THIS BACK)
app.use('/api/users', userRoutes);     // This is for user management
app.use('/api/brevo', brevoRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/subscribers', subscriberRoutes);
app.use('/api/lists', listRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/templates/brevo', templateSyncRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/canva', canvaRoutes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'CampaignFlow API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      auth: '/api/auth',
      campaigns: '/api/campaigns',
      templates: '/api/templates',
      subscribers: '/api/subscribers',
      user: '/api/auth'
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);

  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  res.status(status).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Client URL: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);

  // Start the WhatsApp campaign scheduler daemon loop
  setInterval(whatsappController.runSchedulerCycle, 4000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      process.exit(0);
    });
  });
});

module.exports = app;