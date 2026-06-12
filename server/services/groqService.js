const axios = require('axios');
const { settings } = require('./signalEngine/config');
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const { SIGNAL_AI_429_COOLDOWN_MS } = settings;

let groqRateLimitCooldownUntil = 0;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askGroqWithMeta(prompt, fallback = null, options = {}) {
  const retryCount = Math.max(0, Number(options.retryCount || 0));
  const retryBackoffMs = Math.max(100, Number(options.retryBackoffMs || 1000));
  const timeoutMs = Math.max(500, Number(options.timeoutMs || 10000));
  const maxTokens = Math.max(100, Math.min(4000, Number(options.maxTokens || 300)));

  if (!GROQ_API_KEY) {
    console.warn('[Groq] API key not set');
    return { text: fallback, attempts: 0, error: 'missing_api_key' };
  }

  if (Date.now() < groqRateLimitCooldownUntil) {
    return {
      text: fallback,
      attempts: 0,
      error: `rate_limited_cooldown_active_until_${new Date(groqRateLimitCooldownUntil).toISOString()}`
    };
  }

  let attempts = 0;
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    attempts += 1;
    try {
      const response = await axios.post(GROQ_URL, {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: maxTokens
      }, {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: timeoutMs
      });

      const text = response.data?.choices?.[0]?.message?.content;
      return { text: text ? text.trim() : fallback, attempts, error: null };
    } catch (error) {
      lastError = error;
      const message = error?.message || 'unknown_error';
      const statusCode = Number(error?.response?.status || 0);
      const isRateLimited = statusCode === 429 || /429/.test(String(message));
      console.error(`[Groq] Error (attempt ${attempts}/${retryCount + 1}): ${message}`);

      if (isRateLimited) {
        groqRateLimitCooldownUntil = Date.now() + SIGNAL_AI_429_COOLDOWN_MS;
        console.error(`[Groq] 429 detected. Cooldown active until ${new Date(groqRateLimitCooldownUntil).toISOString()}`);
        break;
      }

      if (attempt < retryCount) {
        const delayMs = retryBackoffMs * Math.pow(2, attempt);
        await wait(delayMs);
      }
    }
  }

  return {
    text: fallback,
    attempts,
    error: lastError?.message || 'grok_request_failed'
  };
}

async function askGroq(prompt, fallback = null) {
  const response = await askGroqWithMeta(prompt, fallback);
  return response.text;
}

module.exports = {
  askGroq,
  askGroqWithMeta,
  __resetGroqRateLimitState: () => {
    groqRateLimitCooldownUntil = 0;
  },
  __getGroqRateLimitState: () => ({
    cooldownUntil: groqRateLimitCooldownUntil
  })
};
