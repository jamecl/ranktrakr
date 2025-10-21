// services/dataforSEOService.js
// Chicago by default. Returns full ranking URL for your domain.
// Adds a previewTop() helper used by the debug route.

const LOCATION_CODE = Number(process.env.DATAFORSEO_LOCATION_CODE) || 1016367; // Chicago, IL
const SEARCH_ENGINE = process.env.DATAFORSEO_SE || 'google.com';
const LANGUAGE_CODE = process.env.DATAFORSEO_LANG || 'en';
const DEVICE = process.env.DATAFORSEO_DEVICE || 'desktop';
const OS = process.env.DATAFORSEO_OS || 'windows';
const DEPTH = Number(process.env.DATAFORSEO_DEPTH) || 100;

// Auth: either set DATAFORSEO_AUTH_HEADER (e.g., "Basic base64...")
// or DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD.
function authHeaders() {
  if (process.env.DATAFORSEO_AUTH_HEADER) {
    return { Authorization: process.env.DATAFORSEO_AUTH_HEADER };
  }
  const u = process.env.DATAFORSEO_LOGIN || '';
  const p = process.env.DATAFORSEO_PASSWORD || '';
  const basic = Buffer.from(`${u}:${p}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

function hostFromUrl(url = '') {
  try { return new URL(url).hostname; } catch { return ''; }
}
function matchesDomain(itemUrl, targetDomain) {
  const h = hostFromUrl(itemUrl).toLowerCase();
  const d = String(targetDomain || '').toLowerCase();
  return !!d && (h === d || h.endsWith(`.${d}`));
}

async function callDataForSEO(keyword, locationCode) {
  const endpoint = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
  const payload = [{
    keyword,
    se: SEARCH_ENGINE,
    location_code: Number(locationCode),
    language_code: LANGUAGE_CODE,
    device: DEVICE,
    os: OS,
    depth: DEPTH
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
  const task = json?.tasks?.[0];
  const result = task?.result?.[0];
  const items = result?.items || [];
  return items;
}

class DataForSEOService {
  // Returns { position, url, serpFeatures } OR null
  async getSerpResults(keyword, targetDomain, locationCode = LOCATION_CODE) {
    const items = await callDataForSEO(keyword, locationCode);

    // First organic result that matches target domain
    const organic = items.find(
      (it) => it.type === 'organic' && it.url && matchesDomain(it.url, targetDomain)
    );
    if (!organic) return null;

    return {
      position: Number(organic.rank_absolute ?? organic.rank ?? 0) || null,
      url: organic.url,
      serpFeatures: Array.isArray(organic.serp_features) ? organic.serp_features : [],
    };
  }

  // Used by /api/keywords/debug/serp — shows the first N SERP items + matches for your domain
  async previewTop(keyword, targetDomain, locationCode = LOCATION_CODE, topN = 10) {
    const items = await callDataForSEO(keyword, locationCode);

    // Map top-N items (any type)
    const top = items
      .slice(0, topN)
      .map((it) => ({
        rank: Number(it.rank_absolute ?? it.rank ?? null),
        type: it.type || '',
        host: hostFromUrl(it.url),
        url: it.url || ''
      }));

    // All matching organic items for your domain (any position)
    const matches = items
      .filter((it) => it.type === 'organic' && it.url && matchesDomain(it.url, targetDomain))
      .map((it) => ({
        rank: Number(it.rank_absolute ?? it.rank ?? null),
        type: it.type || '',
        host: hostFromUrl(it.url),
        url: it.url || ''
      }));

    return {
      success: true,
      kw: keyword,
      domain: targetDomain,
      matchCount: matches.length,
      top10: top,
      matches
    };
  }

  // Batch helper with gentle concurrency
  async batchGetRankings(keywords, targetDomain, locationCode = LOCATION_CODE) {
    const out = [];
    const queue = [...keywords];
    const CONCURRENCY = 4;
    const running = new Set();

    const runOne = async (kw) => {
      try {
        const result = await this.getSerpResults(kw, targetDomain, locationCode);
        out.push({ keyword: kw, result, error: null });
      } catch (e) {
        out.push({ keyword: kw, result: null, error: e.message || String(e) });
      }
    };

    while (queue.length || running.size) {
      while (queue.length && running.size < CONCURRENCY) {
        const kw = queue.shift();
        const p = runOne(kw).finally(() => running.delete(p));
        running.add(p);
      }
      // eslint-disable-next-line no-await-in-loop
      await Promise.race(running);
    }

    return out;
  }
}

module.exports = new DataForSEOService();
