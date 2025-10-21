const pool = require('../config/database');
const dataforSEOService = require('./dataforSEOService');

class RankingService {
  async updateAllKeywordRankings() {
    const client = await pool.connect();
    try {
      const { rows: keywords } = await client.query(
        'SELECT id, keyword, target_domain FROM keywords'
      );

      console.log(`Updating rankings for ${keywords.length} keywords...`);

      const keywordList = keywords.map((k) => k.keyword);
      const targetDomain = keywords[0]?.target_domain || 'blumenshinelawgroup.com';

      const rankings = await dataforSEOService.batchGetRankings(keywordList, targetDomain);

      // Debug summary
      console.log('Update summary:', {
        keywordCount: keywords.length,
        resultsWithPositions: rankings.filter((r) => r?.result && r.result.position != null).length,
        errors: rankings.filter((r) => r?.error).length,
        sample: rankings.slice(0, 5),
      });

      for (const { keyword, result, error } of rankings) {
        if (error) {
          console.error(`Error updating ${keyword}:`, error);
          continue;
        }
        const keywordData = keywords.find((k) => k.keyword === keyword);
        if (!keywordData) continue;

        if (result) {
          await this.saveRanking(client, keywordData.id, keyword, result);
        } else {
          // Record that we checked today but found no ranking (without overwriting any existing row)
          await this.saveNoResult(client, keywordData.id, keyword);
        }
      }

      await this.calculateDeltas(client);
      console.log('Rankings update completed');
    } catch (error) {
      console.error('Error updating rankings:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async saveRanking(client, keywordId, keyword, rankingData) {
    const query = `
      INSERT INTO keyword_rankings (
        keyword_id, keyword, ranking_position, ranking_url,
        search_volume, competition, cpc, serp_features, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)
      ON CONFLICT (keyword_id, timestamp)
      DO UPDATE SET
        ranking_position = EXCLUDED.ranking_position,
        ranking_url      = EXCLUDED.ranking_url,
        search_volume    = EXCLUDED.search_volume,
        competition      = EXCLUDED.competition,
        cpc              = EXCLUDED.cpc,
        serp_features    = EXCLUDED.serp_features
    `;
    await client.query(query, [
      keywordId,
      keyword,
      rankingData.position ?? null,
      rankingData.url ?? null,
      rankingData.searchVolume ?? null,
      rankingData.competition ?? null,
      rankingData.cpc ?? null,
      JSON.stringify(rankingData.serpFeatures ?? []),
    ]);
  }

  // Only insert a NULL-result row if one doesn't exist yet for today.
  // Never overwrite an existing row (prevents “good data -> null” regressions).
  async saveNoResult(client, keywordId, keyword) {
    const query = `
      INSERT INTO keyword_rankings (
        keyword_id, keyword, ranking_position, ranking_url,
        search_volume, competition, cpc, serp_features, timestamp
      ) VALUES ($1, $2, NULL, NULL, NULL, NULL, NULL, '[]', CURRENT_DATE)
      ON CONFLICT (keyword_id, timestamp) DO NOTHING
    `;
    await client.query(query, [keywordId, keyword]);
  }

  async calculateDeltas(client) {
    const deltaQuery = `
      UPDATE keyword_rankings kr
      SET
        delta_7 = CASE
          WHEN prev7.ranking_position IS NOT NULL
          THEN prev7.ranking_position - kr.ranking_position
          ELSE NULL
        END,
        delta_30 = CASE
          WHEN prev30.ranking_position IS NOT NULL
          THEN prev30.ranking_position - kr.ranking_position
          ELSE NULL
        END
      FROM (
        SELECT DISTINCT ON (keyword_id)
          keyword_id, ranking_position
        FROM keyword_rankings
        WHERE timestamp = CURRENT_DATE - INTERVAL '7 days'
        ORDER BY keyword_id, timestamp DESC
      ) prev7,
      (
        SELECT DISTINCT ON (keyword_id)
          keyword_id, ranking_position
        FROM keyword_rankings
        WHERE timestamp = CURRENT_DATE - INTERVAL '30 days'
        ORDER BY keyword_id, timestamp DESC
      ) prev30
      WHERE kr.timestamp = CURRENT_DATE
        AND kr.keyword_id = prev7.keyword_id
        AND kr.keyword_id = prev30.keyword_id
    `;
    await client.query(deltaQuery);
  }

  async getKeywordRankings(keywordId, days = 30) {
    const query = `
      SELECT
        ranking_position,
        ranking_url,
        search_volume,
        timestamp,
        delta_7,
        delta_30
      FROM keyword_rankings
      WHERE keyword_id = $1
        AND timestamp >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY timestamp ASC
    `;
    const { rows } = await pool.query(query, [keywordId]);
    return rows;
  }

  async getLatestRankings() {
    const query = `
      SELECT * FROM latest_rankings
      ORDER BY ranking_position ASC NULLS LAST
    `;
    const { rows } = await pool.query(query);
    return rows;
  }
}

module.exports = new RankingService();
