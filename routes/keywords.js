const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const rankingService = require('../services/rankingService');
const dataforSEOService = require('../services/dataforSEOService');

// Get all keywords with latest rankings
router.get('/', async (req, res) => {
  try {
    const rankings = await rankingService.getLatestRankings();
    res.json({ success: true, source: 'no-view', count: rankings.length, data: rankings });
  } catch (error) {
    console.error('Error fetching keywords:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific keyword with historical data
// Add new keyword (fast: just insert; ranking happens later via /api/keywords/update)
router.post('/', async (req, res) => {
  try {
    const { keyword, targetDomain = 'blumenshinelawgroup.com' } = req.body;

    if (!keyword) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }

    const query = `
      INSERT INTO keywords (keyword, target_domain)
      VALUES ($1, $2)
      RETURNING *
    `;

    const { rows: [newKeyword] } = await pool.query(query, [keyword, targetDomain]);

    // Note: we no longer call dataforSEOService here — that runs later via /api/keywords/update
    return res.json({ success: true, data: newKeyword, pending: true });
  } catch (error) {
    if (error.code === '23505') {
      // unique violation -> already exists
      return res.status(409).json({ success: false, error: 'Keyword already exists' });
    }
    console.error('Error adding keyword:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});


// Delete keyword
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM keywords WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting keyword:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Trigger manual ranking update
router.post('/update', async (req, res) => {
  try {
    await rankingService.updateAllKeywordRankings();
    res.json({ success: true, message: 'Rankings updated successfully' });
  } catch (error) {
    console.error('Error updating rankings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;