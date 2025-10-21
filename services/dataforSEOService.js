// services/dataforSEOService.js
const BASE = process.env.DATAFORSEO_BASE || 'https://api.dataforseo.com';
const LOGIN = process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;

function authHeader() {
  if (!LOGIN || !PASSWORD) {
    throw new Error('DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD not set');
  }
  const b64 = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');
  return `Basic ${b64}`;
}

async function dfetch(path, { method = 'POST', body = null } = {}) {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : null
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('DF ERROR', { url, status: res.status, statusText: res.statusText, body: text?.slice(0, 500) });
      throw new Error(`HTTP ${res.status} ${res.statusText} - ${text?.slice(0, 200)}`);
    }
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    console.error('DF FETCH FAILED', { url, message: e.message });
    throw new Error(`fetch failed: ${e.message}`);
  }
}

// Flatten whatever DF returns into a single array of result items
function extractItems(dfTaskResult0) {
  if (!dfTaskResult0 || typeof dfTaskResult0 !== 'object') return [];

  // Common case
  if (Array.isArray(dfTaskResult0.items)) return dfTaskResult0.items;

  // Some sections nest arrays or have { items: [] } under different keys.
  let out = [];
  for (const v of Object.values(dfTaskResult0)) {
    if (Array.isArray(v)) {
      out = out.concat(v);
    } else if (v && typeof v === 'object' && Array.isArray(v.items)) {
      out = out.concat(v.items);
    }
  }
  return out;
}

async function previewTop(keyword, targetDomain, locationCode) {
  const loc =
    Number(locationCode) ||
    Number(process.env.DF_LOCATION_CODE) ||
    1016367; // Chicago, Cook County, IL

  const payload = [
    {
      keyword,
      location_code: loc,
      language_code: 'en',
      device: 'desktop',
      os: 'windows',
      depth: 100,
      target: targetDomain
    }
  ];

  const data = await dfetch('/v3/serp/google/organic/live/advanced', payload);

  const result0 = data?.tasks?.[0]?.result?.[0] || {};
  const items = extractItems(result0);

  const normalized = items
    .map(it => ({
      rank: Number(it.rank_group ?? it.rank_absolute ?? it.rank ?? 0),
      type: it.type || '',
      host: it.domain || (typeof it.url === 'string' ? (it.url.split('/')[2] || '') : ''),
      url: it.url || ''
    }))
    .filter(r => Number.isFinite(r.rank) && r.rank > 0)
    .sort((a, b) => a.rank - b.rank);

  const top10 = normalized.slice(0, 10);
  const matches = normalized.filter(i => (i.host || '').includes(targetDomain));

  return { top10, matches };
}

async function getSerpResults(keyword, targetDomain, locationCode) {
  const { top10, matches } = await previewTop(keyword, targetDomain, locationCode);
  const best = matches.sort((a, b) => a.rank - b.rank)[0];

  return best
    ? {
        position: best.rank,
        url: best.url,
        searchVolume: null,
        competition: null,
        cpc: null,
        serpFeatures: []
      }
    : null;
}

module.exports = { previewTop, getSerpResults };
