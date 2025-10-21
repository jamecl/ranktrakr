// services/dataforSEOService.js

// Node 18+ has global fetch. If you’re on older Node, install node-fetch.
const btoa = (str) => Buffer.from(str).toString('base64');

class DataForSEOService {
  constructor() {
    this.base = 'https://api.dataforseo.com/v3';
    this.authHeader = 'Basic ' + btoa(
      `${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`
    );
  }

  // --- helpers ---
  _hostname(u) {
    try {
      return new URL(u).hostname.toLowerCase();
    } catch {
      return (u || '').toLowerCase();
    }
  }

  _matchesTarget(urlOrDomain, targetDomain) {
    const host = this._hostname(urlOrDomain);
    const t = String(targetDomain || '').toLowerCase().replace(/^https?:\/\//, '');
    if (!host || !t) return false;
    return host === t || host.endsWith('.' + t) || host.includes(t);
  }

  /**
   * Fetch Google Organic SERP (Chicago) and find first result for targetDomain
   * Returns { position, url, serpFeatures } | null
   */
  async getSerpResults(keyword, targetDomain, opts = {}) {
    const {
      // Use location_name for Chicago to avoid code mismatch issues
      location_name = 'Chicago,Illinois,United States',
      language_code = 'en',
      device = 'desktop',
      os = 'windows',
      depth = 100
    } = opts;

    // IMPORTANT: do NOT send `target` here — we’ll match locally
    const payload = [{
      keyword,
      location_name,
      language_code,
      device,
      os,
      depth
    }];

    const res = await fetch(`${this.base}/serp/google/organic/live/advanced`, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DataForSEO HTTP ${res.status}: ${text || res.statusText}`);
    }

    const data = await res.json();
    const items = data?.tasks?.[0]?.result?.[0]?.items || [];

    let found = null;
    for (const it of items) {
      const url = it.url || it.relative_url || '';
      const domain = it.domain || '';
      if (this._matchesTarget(url || domain, targetDomain)) {
        found = {
          position: it.rank_absolute ?? it.rank_group ?? null,
          url: url || (domain ? `https://${domain}` : ''),
          serpFeatures: {
            type: it.type,
            is_featured_snippet: !!it.is_featured_snippet,
            pixel_position: it.pixel_position ?? null
          }
        };
        break;
      }
    }

    if (!found && items.length) {
      // Lightweight debug so we can see why nothing matched
      console.log(
        '[DataForSEO] No match for',
        targetDomain,
        'in first 5 items of',
        `"${keyword}"`,
        items.slice(0, 5).map(i => ({ rank: i.rank_absolute, domain: i.domain, url: i.url }))
      );
    }

    return found; // may be null if not in top N
  }

  /**
   * Batch wrapper so we can update multiple keywords
   */
  async batchGetRankings(keywords, targetDomain, opts = {}) {
    const out = [];
    for (const kw of keywords) {
      try {
        const result = await this.getSerpResults(kw, targetDomain, opts);
        out.push({ keyword: kw, result, error: null });
      } catch (e) {
        out.push({ keyword: kw, result: null, error: e.message || String(e) });
      }
    }
    return out;
  }
}

module.exports = new DataForSEOService();
