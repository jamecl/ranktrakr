// services/dataforSEOService.js
const BASE = process.env.DATAFORSEO_BASE || 'https://api.dataforseo.com';
const LOGIN = process.env.DATAFORSEO_LOGIN;
const PASSWORD = process.env.DATAFORSEO_PASSWORD;

// helper to build Basic auth header
function authHeader() {
  if (!LOGIN || !PASSWORD) {
    throw new Error('DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD not set');
  }
  const b64 = Buffer.from(`${LOGIN}:${PASSWORD}`).toString('base64');
  return `Basic ${b64}`;
}

// central fetch with strong error reporting
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

    const text = await res.text(); // capture raw body for diagnostics
    if (!res.ok) {
      // log full detail to server logs
      console.error('DF ERROR', { url, status: res.status, statusText: res.statusText, body: text?.slice(0, 500) });
      throw new Error(`HTTP ${res.status} ${res.statusText} - ${text?.slice(0, 200)}`);
    }
    // try JSON, fall back to text
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    console.error('DF FETCH FAILED', { url, message: e.message, stack: e.stack });
    throw new Error(`fetch failed: ${e.message}`);
  }
}

// Returns top-10 snapshot + domain matches for quick debugging
async function previewTop(keyword, targetDomain, locationCode) {
  // sensible defaults; allow overrides via env
  const loc =
    Number(locationCode) ||
    Number(process.env.DF_LOCATION_CODE) ||
    1016367; // Chicago, Cook County, IL, US

  const payload = [
    {
      keyword,
      location_code: loc,
      language_code: 'en',
      device: 'desktop',
      os: 'windows',
      depth: 100,
      // optional targeting to highlight a domain in DF result
      target: targetDomain
    }
  ];

  const data = await dfetch('/v3/serp/google/organic/live/advanced', payload);

  // Normalize response
  const items =
    data?.tasks?.[0]?.result?.[0]?.items ||
    data?.tasks?.[0]?.result?.[0]?.top_stories?.items || // just in case
    [];

  const top10 = items
    .filter(it => typeof it.rank_group === 'number')
    .sort((a, b) => a.rank_group - b.rank_group)
    .slice(0, 10)
    .map(it => ({
      rank: it.rank_group,
      type: it.type,
      host: it.domain || it.url?.split('/')[2] || '',
      url: it.url || ''
    }));

  const matches = top10.filter(i => (i.host || '').includes(targetDomain));

  return { top10, matches };
}

// Minimal shape used by rankingService
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

module.exports = {
  previewTop,
  getSerpResults
};
