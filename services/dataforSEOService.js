// services/dataforSEOService.js
const fetch = global.fetch || require('node-fetch'); // Node 18+ has global fetch; fallback for older

class DataForSEOService {
  constructor() {
    this.base = 'https://api.dataforseo.com/v3';
    const login = process.env.DATAFORSEO_LOGIN || process.env.DATAFORSEO_EMAIL || '';
    const password = process.env.DATAFORSEO_PASSWORD || '';
    const basic = Buffer.from(`${login}:${password}`).toString('base64');
    this.authHeader = `Basic ${basic}`;
  }

  // Core POST to advanced live endpoint
  async _postAdvanced(payload) {
    const url = `${this.base}/serp/google/organic/live/advanced`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DataForSEO HTTP ${res.status}: ${text || res.statusText}`);
    }

    const data = await res.json();
    const results = data?.tasks?.[0]?.result?.[0] || {};
    return results;
  }

  /**
   * Get result object for a single keyword/domain, Chicago by default.
   * Returns { position, url, searchVolume, competition, cpc, serpFeatures } or null.
   */
  async getSerpResults(
    keyword,
    targetDomain,
    {
      location_code = 2840, // Chicago
      location_name = 'Chicago,Illinois,United States',
      language_code = 'en',
      device = 'desktop',
      os = 'windows',
      depth = 100,
      se_name = 'google.com'
    } = {}
  ) {
    const payload = [{
      keyword,
      location_code,
      location_name,
      language_code,
      device,
      os,
      depth,
      se_name
    }];

    const result = await this._postAdvanced(payload);
    const items = result.items || [];

    // find first organic result that matches targetDomain
    const match = this._findMatch(items, targetDomain);

    if (!match) return null;

    // map metrics if present at the result level
    const vol = result.search_volume ?? null;
    const comp = result.competition ?? null;
    const cpc = result.cpc ?? null;

    return {
      position: match.rank_absolute ?? match.rank_group ?? null,
      url: match.url || match.link || null,
      searchVolume: vol,
      competition: comp,
      cpc,
      serpFeatures: result.serp_features || []
    };
  }

  /**
   * Batch get rankings for many keywords.
   * Returns array of { keyword, result, error }
   */
  async batchGetRankings(
    keywords,
    targetDomain,
    opts = {}
  ) {
    const MAX_BATCH = 10; // keep batches small for live endpoint
    const out = [];

    for (let i = 0; i < keywords.length; i += MAX_BATCH) {
      const slice = keywords.slice(i, i + MAX_BATCH);

      const payload = slice.map(k => ({
        keyword: k,
        location_code: opts.location_code ?? 2840,
        location_name: opts.location_name ?? 'Chicago,Illinois,United States',
        language_code: opts.language_code ?? 'en',
        device: opts.device ?? 'desktop',
        os: opts.os ?? 'windows',
        depth: opts.depth ?? 100,
        se_name: opts.se_name ?? 'google.com'
      }));

      try {
        const url = `${this.base}/serp/google/organic/live/advanced`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`DataForSEO HTTP ${res.status}: ${text || res.statusText}`);
        }

        const data = await res.json();
        const tasks = data?.tasks || [];

        // Each task corresponds to a keyword in the same order.
        for (let t = 0; t < tasks.length; t++) {
          const task = tasks[t];
          const originalKeyword = slice[t];
          let resultObj = null;
          let error = null;

          try {
            const taskResult = task?.result?.[0] || {};
            const items = taskResult.items || [];
            const match = this._findMatch(items, targetDomain);
            if (match) {
              resultObj = {
                position: match.rank_absolute ?? match.rank_group ?? null,
                url: match.url || match.link || null,
                searchVolume: taskResult.search_volume ?? null,
                competition: taskResult.competition ?? null,
                cpc: taskResult.cpc ?? null,
                serpFeatures: taskResult.serp_features || []
              };
            } else {
              resultObj = null;
            }
          } catch (e) {
            error = e.message || String(e);
          }

          out.push({ keyword: originalKeyword, result: resultObj, error });
        }
      } catch (e) {
        // If the whole batch fails, mark all in the slice as errored
        for (const k of slice) {
          out.push({ keyword: k, result: null, error: e.message || String(e) });
        }
      }
    }

    return out;
  }

  /**
   * Return simplified top items for quick inspection (debug)
   * [{ rank, type, host, url }]
   */
  async previewTop(keyword, opts = {}) {
    const {
      location_code = 2840,
      location_name = 'Chicago,Illinois,United States',
      language_code = 'en',
      device = 'desktop',
      os = 'windows',
      depth = 100,
      se_name = 'google.com'
    } = opts;

    const payload = [{
      keyword,
      location_code,
      location_name,
      language_code,
      device,
      os,
      depth,
      se_name
    }];

    const result = await this._postAdvanced(payload);
    const items = result.items || [];

    return items.slice(0, 50).map(it => {
      const url = it.url || it.link || it.relative_url || '';
      let host = '';
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        host = (it.domain || '').toLowerCase();
      }
      return {
        rank: it.rank_absolute ?? it.rank_group ?? null,
        type: it.type,
        host,
        url
      };
    });
  }

  // Helpers

  _findMatch(items, targetDomain) {
    if (!Array.isArray(items) || !targetDomain) return null;
    const td = String(targetDomain).toLowerCase();

    for (const it of items) {
      const url = it.url || it.link || '';
      let host = '';
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        host = (it.domain || '').toLowerCase();
      }
      if (!host) continue;

      // Match host exactly, subdomain, or contains (looser)
      if (host === td || host.endsWith('.' + td) || host.includes(td)) {
        return it;
      }
    }
    return null;
  }
}

module.exports = new DataForSEOService();
