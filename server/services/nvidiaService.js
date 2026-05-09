const axios = require('axios');
const { settings } = require('./signalEngine/config');

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct';
const { SIGNAL_AI_429_COOLDOWN_MS } = settings;

let nvidiaRateLimitCooldownUntil = 0;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function askNvidiaWithMeta(prompt, fallback = null, options = {}) {
  const retryCount = Math.max(0, Number(options.retryCount || 0));
  const retryBackoffMs = Math.max(100, Number(options.retryBackoffMs || 1000));
  const timeoutMs = Math.max(500, Number(options.timeoutMs || 10000));

  if (!NVIDIA_API_KEY) {
    console.warn('[NVIDIA] API key not set');
    return { text: fallback, attempts: 0, error: 'missing_api_key' };
  }

  if (Date.now() < nvidiaRateLimitCooldownUntil) {
    return {
      text: fallback,
      attempts: 0,
      error: `rate_limited_cooldown_active_until_${new Date(nvidiaRateLimitCooldownUntil).toISOString()}`
    };
  }

  let attempts = 0;
  let lastError = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    attempts += 1;
    try {
      const response = await axios.post(
        NVIDIA_BASE_URL,
        {
          model: NVIDIA_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 300
        },
        {
          headers: {
            Authorization: `Bearer ${NVIDIA_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: timeoutMs
        }
      );

      const text = response.data?.choices?.[0]?.message?.content;
      return { text: text ? text.trim() : fallback, attempts, error: null };
    } catch (error) {
      lastError = error;
      const message = error?.message || 'unknown_error';
      const statusCode = Number(error?.response?.status || 0);
      const isRateLimited = statusCode === 429 || /429/.test(String(message));
      console.error(`[NVIDIA] Error (attempt ${attempts}/${retryCount + 1}): ${message}`);

      if (isRateLimited) {
        nvidiaRateLimitCooldownUntil = Date.now() + SIGNAL_AI_429_COOLDOWN_MS;
        console.error(`[NVIDIA] 429 detected. Cooldown active until ${new Date(nvidiaRateLimitCooldownUntil).toISOString()}`);
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
    error: lastError?.message || 'nvidia_request_failed'
  };
}

module.exports = {
  askNvidiaWithMeta,
  __resetNvidiaRateLimitState: () => {
    nvidiaRateLimitCooldownUntil = 0;
  },
  __getNvidiaRateLimitState: () => ({
    cooldownUntil: nvidiaRateLimitCooldownUntil
  })
};
