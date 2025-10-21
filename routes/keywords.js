const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const rankingService = require('../services/rankingService');
const dataforSEOService = require('../services/dataforSEOService');

/**
 * NOTE ON ORDER:
 * - Static paths (/, /update, /debug/*) come BEFORE '/:id'
 *   so Express doesn't treat "debug" or "update" as an :id.
 */

/* =========================
 *  GET /api/keywords
 *  Latest rankings (view)
 * ========================= */
router.get('/', async (req, res) => {
  try {
    const rankings = await rankingService.getLatestRankings();
    res.json({ success: true, data: rankings });
  } catch (error) {
    console.error('Error fetching keywords:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* =========================
 *  POST /api/keywords/update
 *  Manual “update now”
 * ========================= */
router.post('/update', async (req, res) => {
  try {
    await rankingService.updateAllKeywordRankings();
    res.json({ success: true, message: 'Rankings updated successfully' });
  } catch (error) {
    console.error('Error updating rankings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* =========================
 *  DEBUG: outbound connectivity to DataForSEO
 *  GET /api/keywords/debug/ping-dataforseo
 * ========================= */
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

/* =========================
 *  DEBUG: quick SERP preview
 *  GET /api/keywords/debug/serp?kw=...&domain=...&loc=1016367
 * ========================= */
router.get('/debug/serp', async (req, res) => {
  try {
    const kw = String(req.query.kw || '').trim();
    if (!kw) return res.status(400).json({ success: false, error: 'kw query param is required' });

    const domain = String(req.query.domain || 'blumenshinelawgroup.com').trim().toLowerCase();
    const loc = Number(req.query.loc || process.env.DF_LOCATION_CODE || 1016367); // Chicago default

    // Expecting dataforSEOService.previewTop(kw, domain, loc) to return:
    // { top10: [...], matches: [...], matchCount: number }
    const { top10, matches, matchCount } = await dataforSEOService.previewTop(kw, domain, loc);

    res.json({ success: true, kw, domain, loc, matchCount, top10, matches });
  } catch (e) {
    console.error('GET /debug/serp error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

/* =========================
 *  POST /api/keywords
 *  Add new keyword (inline initial fetch)
 * ========================= */
router.post('/', async (req, res) => {
  try {
    const { keyword, targetDomain = 'blumenshinelawgroup.com' } = req.body;
    const cleaned = (keyword || '').trim();

    if (!cleaned) {
      return res.status(400).json({ success: false, error: 'Keyword is required' });
    }

    const insert = `
      INSERT INTO keywords (keyword, target_domain)
      VALUES ($1, $2)
      RETURNING *
    `;
    const { rows: [newKeyword] } = await pool.query(insert, [cleaned, targetDomain]);

    // Try to store first ranking (non-blocking for UX, but we do inline here)
    try {
      const ranking = await dataforSEOService.getSerpResults(cleaned, targetDomain);
      if (ranking) {
        const client = await pool.connect();
        try {
          await rankingService.saveRanking(client, newKeyword.id, cleaned, ranking);
        } finally {
          client.release();
        }
      }
    } catch (e) {
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

/* =========================
 *  DELETE /api/keywords/:id
 * ========================= */
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM keywords WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting keyword:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* =========================
 *  GET /api/keywords/:id
 *  Historical data for a keyword
 * ========================= */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const days = parseInt(req.query.days, 10) || 30;

    const { rows: [keyword] } = await pool.query('SELECT * FROM keywords WHERE id = $1', [id]);
    if (!keyword) {
      return res.status(404).json({ success: false, error: 'Keyword not found' });
    }

    const rankings = await rankingService.getKeywordRankings(id, days);
    res.json({ success: true, data: { keyword, rankings } });
  } catch (error) {
    console.error('Error fetching keyword:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
