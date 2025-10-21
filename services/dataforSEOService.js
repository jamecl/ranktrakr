// services/dataforSEOService.js
'use strict';

// Node 18+ has global fetch
// Auth via env: DFS_LOGIN / DFS_PASSWORD
// Optional env overrides:
//   DFS_LOCATION_CODE (default: Chicago 1016367)
//   DFS_LANGUAGE_CODE (default: 'en')
//   DFS_SE (default: 'google.com')
//   DFS_DEVICE (default: 'desktop')
//   DFS_OS (default: 'windows')
//   DFS_DEPTH (default: 100)

const DFS_LOGIN = process.env.DFS_LOGIN || '';
const DFS_PASSWORD = process.env.DFS_PASSWORD || '';

const DEFAULT_LOCATION_CODE = Number(process.env.DFS_LOCATION_CODE || 1016367); // Chicago, IL
const LANGUAGE_CODE = process.env.DFS_LANGUAGE_CODE || 'en';
const SEARCH_ENGINE = process.env.DFS_SE || 'google.com';
const DEVICE = process.env.DFS_DEVICE || 'desktop';
const OS = process.env.DFS_OS || 'windows';
const DEPTH = Number(process.env.DFS_DEPTH || 100);

function authHeaders() {
  const token = Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

/**
 * Low-level call to DataForSEO live advanced endpoint.
 * Always returns an array of SERP items (possibly empty).
 */
async function callDataForSEO(keyword, locationCode) {
  const endpoint = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

  const payload = [{
    keyword,
    se: SEARCH_ENGINE,
    language_code: LANGUAGE_CODE,
    location_code: Number(locationCode || DEFAULT_LOCATION_CODE),
    device: DEVICE,
    os: OS,
    depth: DEPTH
    // NOTE: `target` is only used for highlighting in some tools; it does not filter the results.
  }];

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`DataForSEO HTTP ${res.status}: ${txt.slice(0, 500)}`);
  }

  const json = await res.json();

  const task = Array.isArray(json?.tasks) ? json.tasks[0] : null;
  if (!task) throw new Error('Malformed DataForSEO response: missing tasks[]');

  // DataForSEO success is status_code 20000 on the *task*
  if (typeof task.status_code === 'number' && task.status_code !== 20000) {
    throw new Error(`DataForSEO error ${task.status_code}: ${task.status_message || 'unknown'}`);
  }

  const r0 = Array.isArray(task.result) ? task.result[0] : null;
  const items = Array.isArray(r0?.items) ? r0.items : [];
  return items;
}

/**
 * Find best organic match for a domain.
 * Returns { position, url, serpFeatures } or null if not found within DEPTH.
 */
function pickDomainMatch(items, targetDomain) {
  if (!Array.isArray(items) || !targetDomain) return null;

  // Only consider items that actually have a URL (skip PAA, AI overview, etc.)
  const withUrl = items.filter(it => typeof it.url === 'string' && it.url);

  // Find first organic result whose URL host contains the domain
  const firstOrganic = withUrl.find(it =>
    (it.type === 'organic' || it.type === 'featured_snippet') &&
    (it.domain || it.url || '').toLowerCase().includes(targetDomain.toLowerCase())
  );

  if (!firstOrganic) return null;

  const serpFeatures = [];
  if (firstOrganic.type && firstOrganic.type !== 'organic') serpFeatures.push(firstOrganic.type);
  if (Array.isArray(firstOrganic.serp_features)) serpFeatures.push(...firstOrganic.serp_features);

  return {
    position: Number(firstOrganic.rank_group || firstOrganic.rank_absolute || firstOrganic.rank || 0),
    url: firstOrganic.url,
    serpFeatures
  };
}

/**
 * Public: get SERP result for a single keyword.
 * Returns object with shape used by rankingService.saveRanking
 */
async function getSerpResults(keyword, targetDomain, locationCode) {
  const items = await callDataForSEO(keyword, locationCode);
  const match = pickDomainMatch(items, targetDomain);
  if (!match) return null;

  // We’re not pulling volume/competition/cpc in this live call.
  return {
    position: match.position,
    url: match.url,
    searchVolume: null,
    competition: null,
    cpc: null,
    serpFeatures: match.serpFeatures || []
  };
}

/**
 * Public: batch process a list of keywords.
 * Returns array of { keyword, result, error }
 */
async function batchGetRankings(keywords, targetDomain, locationCode) {
  const out = [];
  for (const kw of keywords) {
    try {
      const result = await getSerpResults(kw, targetDomain, locationCode);
      out.push({ keyword: kw, result, error: null });
    } catch (e) {
      out.push({ keyword: kw, result: null, error: e.message || String(e) });
    }
  }
  return out;
}

/**
 * Public: preview top-N results for a keyword (debug route).
 */
async function previewTop(keyword, locationCode, topN = 10) {
  const items = await callDataForSEO(keyword, locationCode);
  const arr = Array.isArray(items) ? items : [];
  return arr
    .filter(it => it && it.url)
    .slice(0, topN)
    .map(it => ({
      rank: Number(it.rank_group || it.rank_absolute || it.rank || 0),
      type: it.type || 'organic',
      host: (it.domain || ''),
      url: it.url
    }));
}

module.exports = {
  getSerpResults,
  batchGetRankings,
  previewTop
};
