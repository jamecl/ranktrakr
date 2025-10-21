// services/dataforSEOService.js
class DataForSEOService {
  constructor() {
    this.endpoint = 'https://api.dataforseo.com/v3/serp/google/organic/live/regular';
  }

  _authHeader() {
   const DFS_LOGIN =
  process.env.DFS_LOGIN ||
  process.env.DATAFORSEO_LOGIN;

const DFS_PASSWORD =
  process.env.DFS_PASSWORD ||
  process.env.DATAFORSEO_PASSWORD;

if (!DFS_LOGIN || !DFS_PASSWORD) {
  throw new Error('Missing DataForSEO credentials');
}
    return 'Basic ' + Buffer.from(`${DFS_LOGIN}:${DFS_PASSWORD}`).toString('base64');
  }

  async _call(body) {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: this._authHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`DataForSEO returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}`);
    }
    return { status: res.status, json };
  }

  _mapItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((it, i) => {
      const url = it.url || '';
      let host = '';
      try { host = url ? new URL(url).host : ''; } catch { host = ''; }
      return {
        rank: it.rank_absolute ?? it.rank_group ?? (i + 1),
        type: it.type || 'organic',
        host,
        url,
      };
    });
  }

  /**
   * Quick preview of SERP items for a single keyword.
   * Returns top10 + matches for target domain.
   */
  async previewTop(keyword, domain, location_code) {
    const body = [{
      keyword,
      // location: prefer numeric code; fallback to Chicago if not provided
      location_code: Number(location_code) || Number(process.env.DF_LOCATION_CODE) || 1016367, // Chicago
      language_code: 'en',
      device: 'desktop',
      depth: 100,

      // Be generous: include both names some examples use
      se: 'google.com',
      se_name: 'google.com',
    }];

    const { json } = await this._call(body);

    // DataForSEO typical success:
    // { status_code: 20000, tasks: [ { status_code: 20000, result: [ { items: [...] } ] } ] }
    const task = Array.isArray(json?.tasks) ? json.tasks[0] : null;
    if (!task || (task.status_code && task.status_code !== 20000)) {
      // surface their message if present
      const msg = task?.status_message || json?.status_message || 'DataForSEO error / no tasks';
      // Return empty arrays (debug route will show empty); callers won’t crash
      return { top10: [], matches: [], matchCount: 0, meta: { status_code: task?.status_code, msg } };
    }

    const result = Array.isArray(task.result) ? task.result[0] : null;
    const items = result?.items;
    const mapped = this._mapItems(items);

    const d = (domain || '').toLowerCase();
    const matches = d
      ? mapped.filter((i) => {
          const h = (i.host || '').toLowerCase();
          return h === d || h.endsWith('.' + d) || (i.url || '').toLowerCase().includes(d);
        })
      : [];

    return {
      top10: mapped.slice(0, 10),
      matches,
      matchCount: matches.length,
    };
  }

  /**
   * Return a single ranking object for DB storage (or null if not found)
   */
  async getSerpResults(keyword, targetDomain, opts = {}) {
    const loc = opts.location_code || Number(process.env.DF_LOCATION_CODE) || 1016367;
    const { matches } = await this.previewTop(keyword, targetDomain, loc);
    const best = matches[0] || null;
    if (!best) return null;

    return {
      position: best.rank,
      url: best.url,
      searchVolume: null,
      competition: null,
      cpc: null,
      serpFeatures: [],
    };
  }

  /**
   * Simple sequential batch (keeps it easy to trace for now)
   */
  async batchGetRankings(keywords, targetDomain, opts = {}) {
    const out = [];
    for (const kw of keywords) {
      try {
        const result = await this.getSerpResults(kw, targetDomain, opts);
        out.push({ keyword: kw, result, error: null });
      } catch (e) {
        out.push({ keyword: kw, result: null, error: e.message });
      }
    }
    return out;
  }
}

module.exports = new DataForSEOService();
