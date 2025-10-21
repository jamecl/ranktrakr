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

      const keywordList = keywords.map(k => k.keyword);
      const targetDomain = keywords[0]?.target_domain || 'blumenshinelawgroup.com';
      
      const rankings = await dataforSEOService.batchGetRankings(
        keywordList,
        targetDomain
      );

      for (const { keyword, result, error } of rankings) {
        if (error) {
          console.error(`Error updating ${keyword}:`, error);
          continue;
        }

        const keywordData = keywords.find(k => k.keyword === keyword);
        if (!keywordData || !result) continue;

        await this.saveRanking(client, keywordData.id, keyword, result);
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
        ranking_url = EXCLUDED.ranking_url,
        search_volume = EXCLUDED.search_volume,
        competition = EXCLUDED.competition,
        cpc = EXCLUDED.cpc,
        serp_features = EXCLUDED.serp_features
    `;

    await client.query(query, [
      keywordId,
      keyword,
      rankingData.position,
      rankingData.url,
      rankingData.searchVolume,
      rankingData.competition,
      rankingData.cpc,
      JSON.stringify(rankingData.serpFeatures)
    ]);
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
    SELECT
      k.id AS keyword_id,
      k.keyword,
      k.target_domain,
      kr.ranking_position,
      kr.ranking_url,
      kr.search_volume,
      kr.timestamp,
      kr.delta_7,
      kr.delta_30
    FROM keywords k
    LEFT JOIN LATERAL (
      SELECT
        ranking_position,
        ranking_url,
        search_volume,
        timestamp,
        delta_7,
        delta_30
      FROM keyword_rankings
      WHERE keyword_id = k.id
      ORDER BY timestamp DESC
      LIMIT 1
    ) kr ON TRUE
    ORDER BY COALESCE(kr.ranking_position, 999999) ASC NULLS LAST, k.keyword;
  `;
  const { rows } = await pool.query(query);
  return rows;
}

}

module.exports = new RankingService();