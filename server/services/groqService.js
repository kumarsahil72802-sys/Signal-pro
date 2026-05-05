const axios = require('axios');
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

async function askGroq(prompt, fallback = null) {
  if (!GROQ_API_KEY) { console.warn('[Groq] API key not set'); return fallback; }
  try {
    const response = await axios.post(GROQ_URL, {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300
    }, { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 10000 });
    const text = response.data?.choices?.[0]?.message?.content;
    return text ? text.trim() : fallback;
  } catch (error) {
    console.error(`[Groq] Error: ${error.message}`);
    return fallback;
  }
}
module.exports = { askGroq };
