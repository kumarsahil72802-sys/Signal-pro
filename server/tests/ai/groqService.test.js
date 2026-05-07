const test = require('node:test');
const assert = require('node:assert/strict');

const servicePath = require.resolve('../../services/groqService');
const axios = require('axios');

function loadServiceWithKey() {
  process.env.GROQ_API_KEY = 'test-key';
  delete require.cache[servicePath];
  const service = require(servicePath);
  service.__resetGroqRateLimitState();
  return service;
}

test('askGroqWithMeta retries and succeeds on second attempt', async () => {
  const originalPost = axios.post;
  let calls = 0;

  axios.post = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('temporary_error');
    }
    return {
      data: {
        choices: [{ message: { content: '  72  ' } }]
      }
    };
  };

  try {
    const { askGroqWithMeta } = loadServiceWithKey();
    const result = await askGroqWithMeta('prompt', 'fallback', {
      retryCount: 2,
      retryBackoffMs: 1,
      timeoutMs: 1000
    });

    assert.equal(result.text, '72');
    assert.equal(result.attempts, 2);
    assert.equal(result.error, null);
  } finally {
    axios.post = originalPost;
  }
});

test('askGroqWithMeta returns fallback after max retries', async () => {
  const originalPost = axios.post;
  axios.post = async () => {
    throw new Error('upstream_down');
  };

  try {
    const { askGroqWithMeta } = loadServiceWithKey();
    const result = await askGroqWithMeta('prompt', 'fallback', {
      retryCount: 2,
      retryBackoffMs: 1,
      timeoutMs: 1000
    });

    assert.equal(result.text, 'fallback');
    assert.equal(result.attempts, 3);
    assert.match(result.error || '', /upstream_down/);
  } finally {
    axios.post = originalPost;
  }
});

test('askGroqWithMeta exposes timeout-like failure message for fallback path', async () => {
  const originalPost = axios.post;
  axios.post = async () => {
    throw new Error('timeout of 1000ms exceeded');
  };

  try {
    const { askGroqWithMeta } = loadServiceWithKey();
    const result = await askGroqWithMeta('prompt', 'fallback', {
      retryCount: 0,
      timeoutMs: 1000
    });

    assert.equal(result.text, 'fallback');
    assert.equal(result.attempts, 1);
    assert.match(result.error || '', /timeout/);
  } finally {
    axios.post = originalPost;
  }
});

test('askGroqWithMeta sets cooldown on 429 and skips immediate next call', async () => {
  const originalPost = axios.post;
  let calls = 0;

  axios.post = async () => {
    calls += 1;
    const error = new Error('Request failed with status code 429');
    error.response = { status: 429 };
    throw error;
  };

  try {
    const { askGroqWithMeta } = loadServiceWithKey();
    const first = await askGroqWithMeta('prompt', 'fallback', {
      retryCount: 2,
      retryBackoffMs: 1,
      timeoutMs: 1000
    });

    assert.equal(first.text, 'fallback');
    assert.equal(first.attempts, 1);
    assert.match(first.error || '', /429/);
    assert.equal(calls, 1);

    const second = await askGroqWithMeta('prompt', 'fallback', {
      retryCount: 2,
      retryBackoffMs: 1,
      timeoutMs: 1000
    });

    assert.equal(second.text, 'fallback');
    assert.equal(second.attempts, 0);
    assert.match(second.error || '', /rate_limited_cooldown_active/);
    assert.equal(calls, 1);
  } finally {
    axios.post = originalPost;
  }
});
