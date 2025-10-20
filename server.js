const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

const keywordRoutes = require('./routes/keywords');
const rankingService = require('./services/rankingService');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/keywords', keywordRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Schedule daily ranking updates at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('Running scheduled ranking update...');
  try {
    await rankingService.updateAllKeywordRankings();
    console.log('Scheduled update completed successfully');
  } catch (error) {
    console.error('Scheduled update failed:', error);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Daily ranking update scheduled for 2:00 AM');
});