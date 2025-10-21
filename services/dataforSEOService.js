// services/dataforSEOService.js
// Uses DataForSEO "live advanced" endpoint, targets CHICAGO by default,
// and returns the first matching organic result for the target domain.

const LOCATION_CODE = Number(process.env.DATAFORSEO_LOCATION_CODE) || 1016367; // Chicago, IL
const SEARCH_ENGINE = process.env.DATAFORSEO_SE || 'google.com';
const LANGUAGE_CODE = process.env.DATAFORSEO_LANG || 'en';
const DEVICE = process.env.DATAFORSEO_DEVICE || 'desktop';
const OS = process.env.DATAFORSEO_OS || 'windows';
const DEPTH = Number(process.env.DATAFORSEO_DEPTH) || 100;

// If you use login/password auth with DataForSEO, set:
//   DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in Railway.
// If you use API-key header, set DATAFORSEO_AUTH_HEADER instead.
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
  const d = (targetDomain || '').toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

class DataForSEOService {
  // Return { position, url, serpFeatures } OR null
  async getSerpResults(keyword, targetDomain, locationCode = LOCATION_CODE) {
    const endpoint = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

    const payload = [{
      keyword,
      se: SEARCH_ENGINE,
      location_code: Number(locationCode),
      language_code: LANGUAGE_CODE,
      device: DEVICE,
      os: OS,
      depth: DEPTH,
      // NOTE: "target" is not a server-side filter for results; we still scan items.
      // We include it for metadata but we still find the first matching organic result below.
      target: targetDomain
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

    // Find first organic result that matches the target domain
    const organic = items.find(
      (it) => it.type === 'organic' && it.url && matchesDomain(it.url, targetDomain)
    );

    if (!organic) {
      return null;
    }

    return {
      position: Number(organic.rank_absolute || organic.rank || 0) || null,
      url: organic.url,
      serpFeatures: Array.isArray(organic.serp_features) ? organic.serp_features : [],
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
      // wait for one to finish
      // eslint-disable-next-line no-await-in-loop
      await Promise.race(running);
    }

    return out;
  }
}

module.exports = new DataForSEOService();