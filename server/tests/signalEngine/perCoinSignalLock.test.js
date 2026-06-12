const test = require('node:test');
const assert = require('node:assert/strict');

const Signal = require('../../models/Signal');
const binanceService = require('../../services/binanceService');

const generatorPath = require.resolve('../../services/signalEngine/generatorParts/generateSignalForCoin');

function makeSignal(overrides = {}) {
  return {
    _id: overrides._id || 'signal-id',
    coin: overrides.coin || 'ONDOUSDT',
    status: overrides.status || 'ACTIVE',
    result: overrides.result || 'PENDING',
    createdAt: overrides.createdAt || new Date(),
    validUntil: overrides.validUntil ?? new Date(Date.now() + 60 * 60 * 1000),
    ...overrides
  };
}

async function withGeneratorMocks({ initialSignals = [], postExpirySignals = [], testBody }) {
  const originalFind = Signal.find;
  const originalFindOne = Signal.findOne;
  const originalFindByIdAndUpdate = Signal.findByIdAndUpdate;
  const originalGetKlines = binanceService.getKlines;

  let getKlinesCalls = 0;
  const updates = [];

  try {
    Signal.find = async (query) => {
      if (query?.result === 'PENDING') return initialSignals;
      return [];
    };

    Signal.findOne = (query) => {
      if (query?.result === 'PENDING') {
        return Promise.resolve(postExpirySignals[0] || null);
      }
      return {
        sort: async () => null
      };
    };

    Signal.findByIdAndUpdate = async (id, update) => {
      updates.push({ id, update });
      return null;
    };

    binanceService.getKlines = async () => {
      getKlinesCalls += 1;
      return [];
    };

    delete require.cache[generatorPath];
    const { generateSignalForCoin } = require(generatorPath);

    await testBody({
      generateSignalForCoin,
      getKlinesCalls: () => getKlinesCalls,
      updates
    });
  } finally {
    Signal.find = originalFind;
    Signal.findOne = originalFindOne;
    Signal.findByIdAndUpdate = originalFindByIdAndUpdate;
    binanceService.getKlines = originalGetKlines;
    delete require.cache[generatorPath];
  }
}

for (const status of ['ACTIVE', 'TAKEN', 'BLOCKED']) {
  test(`generateSignalForCoin locks coin when ${status}/PENDING signal exists`, async () => {
    await withGeneratorMocks({
      initialSignals: status === 'BLOCKED' ? [] : [makeSignal({ status })],
      postExpirySignals: [makeSignal({ status })],
      testBody: async ({ generateSignalForCoin, getKlinesCalls }) => {
        const gateCounters = { cooldown: 0 };
        const result = await generateSignalForCoin('ONDOUSDT', null, 'UNKNOWN', gateCounters);

        assert.equal(result, null);
        assert.equal(gateCounters.cooldown, 1);
        assert.equal(getKlinesCalls(), 0);
      }
    });
  });
}

test('generateSignalForCoin does not lock on closed target/sl outcomes', async () => {
  await withGeneratorMocks({
    initialSignals: [],
    postExpirySignals: [],
    testBody: async ({ generateSignalForCoin, getKlinesCalls }) => {
      const result = await generateSignalForCoin('ONDOUSDT', null, 'UNKNOWN', { cooldown: 0 });

      assert.equal(result, null);
      assert.equal(getKlinesCalls(), 1);
    }
  });
});

test('generateSignalForCoin expires stale ACTIVE/TAKEN signals before allowing analysis', async () => {
  const expiredSignal = makeSignal({
    _id: 'expired-active-id',
    status: 'ACTIVE',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    validUntil: new Date(Date.now() - 60 * 1000)
  });

  await withGeneratorMocks({
    initialSignals: [expiredSignal],
    postExpirySignals: [],
    testBody: async ({ generateSignalForCoin, getKlinesCalls, updates }) => {
      const result = await generateSignalForCoin('ONDOUSDT', null, 'UNKNOWN', { cooldown: 0 });

      assert.equal(result, null);
      assert.equal(getKlinesCalls(), 1);
      assert.equal(updates.length, 1);
      assert.equal(updates[0].id, 'expired-active-id');
      assert.equal(updates[0].update.status, 'CLOSED');
      assert.equal(updates[0].update.result, 'EXPIRED');
    }
  });
});
