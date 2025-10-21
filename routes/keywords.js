const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const rankingService = require('../services/rankingService');
const dataforSEOService = require('../services/dataforSEOService');

// Get all keywords with latest rankings
router.get('/', async (req, res) => {
  try {
    const rankings = await rankingService.getLatestRankings();
    res.json({ success: true, data: rankings });
  } catch (error) {
    console.error('Error fetching keywords:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific keyword with historical data
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const days = parseInt(req.query.days, 10) || 30;

    const keywordQuery = 'SELECT * FROM keywords WHERE id = $1';
    const { rows: [keyword] } = await pool.query(keywordQuery, [id]);

    if (!keyword) {
      return res.status(404).json({ success: false, error: 'Keyword not found' });
    }

    const rankings = await rankingService.getKeywordRankings(id, days);

    res.json({
      success: true,
      data: {
        keyword,
        rankings
      }
    });
  } catch (error) {
    console.error('Error fetching keyword:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add new keyword
router.post('/', async (req, res) => {
  try {
    const { keyword, targetDomain = 'blumenshinelawgroup.com' } = req.body;

    if (!keyword || !String(keyword).trim()) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }

    const query = `
      INSERT INTO keywords (keyword, target_domain)
      VALUES ($1, $2)
      RETURNING *
    `;

    const { rows: [newKeyword] } = await pool.query(query, [keyword.trim(), targetDomain]);

    // Fetch initial ranking (non-blocking approach is fine; here we do it inline)
    try {
      const ranking = await dataforSEOService.getSerpResults(keyword.trim(), targetDomain);
      if (ranking) {
        const client = await pool.connect();
        try {
          await rankingService.saveRanking(client, newKeyword.id, keyword.trim(), ranking);
        } finally {
          client.release();
        }
      }
    } catch (e) {
      // Don't fail the request if SERP call fails
      console.warn('Initial SERP fetch failed:', e.message);
    }

    res.json({ success: true, data: newKeyword });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'Keyword already exists' });
    }
    console.error('Error adding keyword:', error);
    res.status(500).json({ success: false, error: error.message });
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

/**
 * DEBUG: peek at top SERP items for a keyword (Chicago).
 * Example:
 *   GET /api/keywords/debug/serp?kw=compensation%20for%20moderate%20hearing%20loss&domain=blumenshinelawgroup.com
 */
router.get('/debug/serp', async (req, res) => {
  const kw = (req.query.kw || '').trim();
  const domain = (req.query.domain || '').trim().toLowerCase();

  if (!kw) return res.status(400).json({ success: false, error: 'kw is required' });

  try {
    const items = await dataforSEOService.previewTop(kw, {
      location_code: 1016367, // Chicago
      location_name: 'Chicago,Illinois,United States',
      depth: 100,
      se_name: 'google.com'
    });

    const matches = domain
      ? items.filter(i =>
          i.host === domain ||
          i.host.endsWith('.' + domain) ||
          i.host.includes(domain)
        )
      : [];

    res.json({
      success: true,
      kw,
      domain,
      matchCount: matches.length,
      top10: items.slice(0, 10),
      matches
    });
  } catch (e) {
    console.error('debug/serp error:', e);
    res.status(500).json({ success: false, error: e.message || String(e) });
  }

  // Quick connectivity/auth probe to DataForSEO
router.get('/debug/ping-dataforseo', async (req, res) => {
  try {
    const { DFS_LOGIN, DFS_PASSWORD } = process.env;
    const endpoint = 'https://api.dataforseo.com/v3/serp/google/organic/live/regular';

    // minimal valid task body
    const body = [{
      keyword: 'test',
      location_name: 'Chicago,Illinois,United States',
      language_code: 'en',
      device: 'desktop'
    }];

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const text = await r.text();
    // Return a small slice so we don't spam logs, but keep status & headers
    res.status(200).json({
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      endpoint,
      got: text.slice(0, 800)
    });
  } catch (e) {
    // Node fetch exposes low-level cause codes like ENOTFOUND/ECONNRESET
    res.status(500).json({
      ok: false,
      name: e.name,
      message: e.message,
      cause: (e.cause && (e.cause.code || String(e.cause))) || null
    });
  }
});

});
// --- Diagnostic: check outbound call to DataForSEO ---
router.get('/debug/ping-dataforseo', async (req, res) => {
  try {
    const { DFS_LOGIN, DFS_PASSWORD } = process.env;
    const endpoint = 'https://api.dataforseo.com/v3/serp/google/organic/live/regular';

    const body = [{
      keyword: 'test',
      location_name: 'Chicago,Illinois,United States',
      language_code: 'en',
      device: 'desktop'
    }];

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const text = await r.text();
    res.status(200).json({
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      endpoint,
      sample: text.slice(0, 800) // show first ~800 chars
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      name: e.name,
      message: e.message,
      cause: (e.cause && (e.cause.code || String(e.cause))) || null
    });
  }
});
// --- Diagnostic: check outbound call to DataForSEO ---
router.get('/debug/ping-dataforseo', async (req, res) => {
  try {
    const { DFS_LOGIN, DFS_PASSWORD } = process.env;
    const endpoint = 'https://api.dataforseo.com/v3/serp/google/organic/live/regular';

    const body = [{
      keyword: 'test',
      location_name: 'Chicago,Illinois,United States',
      language_code: 'en',
      device: 'desktop'
    }];

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const text = await r.text();
    res.status(200).json({
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      endpoint,
      sample: text.slice(0, 800)
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      name: e.name,
      message: e.message,
      cause: (e.cause && (e.cause.code || String(e.cause))) || null
    });
  }
});

// --- end diagnostic route ---

module.exports = router;
