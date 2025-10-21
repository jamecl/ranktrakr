const { dataforSEOClient } = require('../config/dataforseo');

class DataForSEOService {
  async getSerpResults(keyword, targetDomain) {
    try {
   const payload = [{
  keyword,
  // ✅ pick ONE of these; we’ll use the name for clarity:
  location_name: "Chicago,Illinois,United States",
  // (If you prefer a numeric code later, we can swap it in and delete location_name)

  language_code: "en",
  device: "desktop",
  os: "windows",
  depth: 100,

  // ✅ match any page on your domain (not just the homepage)
  target: `${targetDomain}*`
  // (You can keep `se: "google.com"` if your code expects it; it's optional.)
}];



      const response = await dataforSEOClient.post(
        '/serp/google/organic/live/advanced',
        payload
      );

      if (response.data.status_code === 20000) {
        return this.parseSerpResponse(response.data.tasks[0]);
      } else {
        throw new Error(`DataForSEO API error: ${response.data.status_message}`);
      }
    } catch (error) {
      console.error('Error fetching SERP results:', error.message);
      throw error;
    }
  }

  parseSerpResponse(task) {
    if (!task.result || task.result.length === 0) {
      return null;
    }

    const result = task.result[0];
    const items = result.items || [];
    
    const targetResult = items.find(item => 
      item.type === 'organic' && item.url
    );

    if (!targetResult) {
      return null;
    }

    return {
      position: targetResult.rank_absolute,
      url: targetResult.url,
      title: targetResult.title,
      description: targetResult.description,
      searchVolume: result.keyword_info?.search_volume || 0,
      competition: result.keyword_info?.competition || 0,
      cpc: result.keyword_info?.cpc || 0,
      serpFeatures: result.serp_features || []
    };
  }

  async batchGetRankings(keywords, targetDomain) {
    const results = [];
    const batchSize = 10;
    
    for (let i = 0; i < keywords.length; i += batchSize) {
      const batch = keywords.slice(i, i + batchSize);
      
      const batchPromises = batch.map(keyword =>
        this.getSerpResults(keyword, targetDomain)
          .then(result => ({ keyword, result, error: null }))
          .catch(error => ({ keyword, result: null, error: error.message }))
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      if (i + batchSize < keywords.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }
}

module.exports = new DataForSEOService();