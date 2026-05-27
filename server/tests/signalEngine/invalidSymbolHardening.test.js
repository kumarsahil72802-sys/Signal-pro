const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { getKlines } = require('../../services/binanceService');
const Signal = require('../../models/Signal');
const binanceService = require('../../services/binanceService');

const generatorPath = require.resolve('../../services/signalEngine/generatorParts/generateSignalForCoin');

test('getKlines classifies Binance -1121 as INVALID_SYMBOL', async () => {
  const originalGet = axios.get;
  axios.get = async () => {
    const error = new Error('Request failed with status code 400');
    error.response = {
      status: 400,
      data: {
        code: -1121,
        msg: 'Invalid symbol.'
      }
    };
    throw error;
  };

  try {
    await assert.rejects(
      () => getKlines('BADUSDT', '1h', 5),
      (error) => {
        assert.equal(error.code, 'INVALID_SYMBOL');
        assert.equal(error.binanceCode, -1121);
        assert.equal(error.symbol, 'BADUSDT');
        return true;
      }
    );
  } finally {
    axios.get = originalGet;
  }
});

test('generateSignalForCoin skips INVALID_SYMBOL non-fatally and quarantines symbol for cycle', async () => {
  const originalGetKlines = binanceService.getKlines;
  const originalFind = Signal.find;
  const originalFindOne = Signal.findOne;
  const originalFindByIdAndUpdate = Signal.findByIdAndUpdate;

  try {
    Signal.find = async () => [];
    Signal.findByIdAndUpdate = async () => null;
    Signal.findOne = (query) => {
      if (query?.result === 'PENDING') {
        return Promise.resolve(null);
      }
      return {
        sort: async () => null
      };
    };

    binanceService.getKlines = async () => {
      const error = new Error('Error fetching klines for BADUSDT: Request failed with status code 400');
      error.code = 'INVALID_SYMBOL';
      error.binanceCode = -1121;
      throw error;
    };

    delete require.cache[generatorPath];
    const { generateSignalForCoin } = require(generatorPath);

    const gateCounters = { invalid_skip: 0 };
    const warnings = [];
    const runtimeContext = {
      tradableSet: new Set(['BADUSDT']),
      invalidSymbolState: {
        warnIssued: false,
        quarantinedSymbols: new Set(),
        preflightSkipped: 0,
        runtimeInvalidCount: 0
      },
      onInvalidSymbolWarning: (message) => warnings.push(message)
    };

    const result = await generateSignalForCoin('BADUSDT', null, 'UNKNOWN', gateCounters, runtimeContext);
    assert.equal(result, null);
    assert.equal(gateCounters.invalid_skip, 1);
    assert.equal(runtimeContext.invalidSymbolState.runtimeInvalidCount, 1);
    assert.equal(runtimeContext.invalidSymbolState.quarantinedSymbols.has('BADUSDT'), true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /INVALID_SYMBOL/);
  } finally {
    binanceService.getKlines = originalGetKlines;
    Signal.find = originalFind;
    Signal.findOne = originalFindOne;
    Signal.findByIdAndUpdate = originalFindByIdAndUpdate;
    delete require.cache[generatorPath];
  }
});
