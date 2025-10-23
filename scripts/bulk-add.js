const keywords = [
  "blumenshine law group",
  "chicago personal injury lawyer",
  "blumenshine attorney",
  // Add all your 100+ keywords here
];

const API_URL = 'https://ranktrakr-production.up.railway.app/api';

async function addKeywords() {
  for (let i = 0; i < keywords.length; i++) {
    try {
      await fetch(`${API_URL}/keywords`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keywords[i] })
      });
      console.log(`✅ [${i+1}/${keywords.length}] ${keywords[i]}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`❌ ${keywords[i]}:`, error.message);
    }
  }
}

addKeywords();