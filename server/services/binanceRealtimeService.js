const WS_BASE_URL = 'wss://stream.binance.com:9443/stream?streams=';
const MAX_SYMBOLS_PER_CONNECTION = 70;
const STALE_AFTER_MS = 90 * 1000;
const TRADE_WINDOW_MS = 15 * 60 * 1000;

const state = {
  symbols: new Set(),
  sockets: [],
  reconnectTimer: null,
  running: false,
  bookTickerBySymbol: new Map(),
  tradeBucketsBySymbol: new Map(),
  cumulativeCvdBySymbol: new Map(),
  tradeListeners: new Set(),
  lastStartReason: 'not_started'
};

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function isUsdtSymbol(symbol) {
  return /^[A-Z0-9]{2,20}USDT$/.test(symbol);
}

function buildChunks(values, chunkSize) {
  const chunks = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function clearReconnectTimer() {
  if (!state.reconnectTimer) return;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}

function closeAllSockets() {
  for (const socket of state.sockets) {
    try {
      socket.close();
    } catch (_error) {
      // ignore close failures
    }
  }
  state.sockets = [];
}

function pruneTradeBuckets(symbol, nowMs = Date.now()) {
  const bucket = state.tradeBucketsBySymbol.get(symbol);
  if (!bucket || !Array.isArray(bucket.trades)) return;
  bucket.trades = bucket.trades.filter((item) => nowMs - item.ts <= TRADE_WINDOW_MS);
}

function addTrade(symbol, payload) {
  if (!payload) return;

  const price = Number(payload.p);
  const quantity = Number(payload.q);
  const ts = Number(payload.T || payload.E || Date.now());
  const isBuyerMaker = payload.m === true;

  if (!Number.isFinite(price) || !Number.isFinite(quantity) || quantity <= 0) return;
  const quote = price * quantity;
  if (!Number.isFinite(quote) || quote <= 0) return;
  const signedQuote = isBuyerMaker ? -quote : quote;

  if (!state.tradeBucketsBySymbol.has(symbol)) {
    state.tradeBucketsBySymbol.set(symbol, { trades: [] });
  }

  const bucket = state.tradeBucketsBySymbol.get(symbol);
  bucket.trades.push({ ts, quote, signedQuote, isBuyerMaker, price });
  pruneTradeBuckets(symbol, Date.now());

  const prevCvd = Number(state.cumulativeCvdBySymbol.get(symbol) || 0);
  state.cumulativeCvdBySymbol.set(symbol, prevCvd + signedQuote);

  notifyTradeListeners({
    symbol,
    price,
    quantity,
    ts,
    isBuyerMaker
  });
}

function notifyTradeListeners(trade) {
  if (!trade || state.tradeListeners.size === 0) return;

  for (const listener of state.tradeListeners) {
    try {
      listener(trade);
    } catch (error) {
      console.error(`[Realtime] Trade listener failed: ${error.message}`);
    }
  }
}

function updateBookTicker(symbol, payload) {
  if (!payload) return;

  const bidPrice = Number(payload.b);
  const askPrice = Number(payload.a);
  const bidQty = Number(payload.B);
  const askQty = Number(payload.A);
  const eventTime = Number(payload.E || Date.now());

  if (!Number.isFinite(bidPrice) || !Number.isFinite(askPrice) || bidPrice <= 0 || askPrice <= 0) return;

  state.bookTickerBySymbol.set(symbol, {
    bidPrice,
    askPrice,
    bidQty: Number.isFinite(bidQty) ? bidQty : 0,
    askQty: Number.isFinite(askQty) ? askQty : 0,
    eventTime
  });
}

function handleMessage(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ''));
  } catch (_error) {
    return;
  }

  const stream = String(parsed.stream || '').toLowerCase();
  const data = parsed.data || parsed;
  const symbol = normalizeSymbol(data?.s);
  if (!symbol) return;

  if (stream.endsWith('@bookticker') || String(data?.e || '').toLowerCase() === 'bookticker') {
    updateBookTicker(symbol, data);
    return;
  }

  if (stream.endsWith('@aggtrade') || String(data?.e || '').toLowerCase() === 'aggtrade') {
    addTrade(symbol, data);
  }
}

function buildStreamUrl(symbolChunk) {
  const streamNames = [];
  for (const symbol of symbolChunk) {
    const lower = symbol.toLowerCase();
    streamNames.push(`${lower}@bookTicker`);
    streamNames.push(`${lower}@aggTrade`);
  }
  return `${WS_BASE_URL}${streamNames.join('/')}`;
}

function scheduleReconnect(reason = 'unknown') {
  if (!state.running) return;
  if (state.reconnectTimer) return;

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    restartConnections(`reconnect:${reason}`);
  }, 3000);
}

function connectChunk(symbolChunk) {
  if (!Array.isArray(symbolChunk) || symbolChunk.length === 0) return;
  if (typeof WebSocket === 'undefined') {
    state.lastStartReason = 'websocket_unavailable';
    return;
  }

  const url = buildStreamUrl(symbolChunk);
  const socket = new WebSocket(url);

  socket.addEventListener('open', () => {
    console.log(`[Realtime] Connected (${symbolChunk.length} symbols)`);
  });

  socket.addEventListener('message', (event) => {
    handleMessage(event?.data);
  });

  socket.addEventListener('error', (event) => {
    const message = event?.message || 'socket_error';
    console.log(`[Realtime] WebSocket error: ${message}`);
  });

  socket.addEventListener('close', () => {
    if (!state.running) return;
    scheduleReconnect('socket_closed');
  });

  state.sockets.push(socket);
}

function restartConnections(reason = 'refresh') {
  if (!state.running) return;

  clearReconnectTimer();
  closeAllSockets();

  const symbolList = [...state.symbols];
  if (symbolList.length === 0) {
    state.lastStartReason = 'no_symbols';
    return;
  }

  if (typeof WebSocket === 'undefined') {
    state.lastStartReason = 'websocket_unavailable';
    console.log('[Realtime] WebSocket global unavailable. Realtime feed disabled.');
    return;
  }

  state.lastStartReason = reason;
  const chunks = buildChunks(symbolList, MAX_SYMBOLS_PER_CONNECTION);
  for (const chunk of chunks) {
    connectChunk(chunk);
  }
}

function startRealtimeMarketData() {
  if (state.running) return;
  state.running = true;
  restartConnections('initial_start');
}

function stopRealtimeMarketData() {
  state.running = false;
  clearReconnectTimer();
  closeAllSockets();
}

function registerRealtimeSymbols(symbols = []) {
  const before = state.symbols.size;
  for (const symbol of symbols) {
    const normalized = normalizeSymbol(symbol);
    if (!isUsdtSymbol(normalized)) continue;
    state.symbols.add(normalized);
    if (!state.cumulativeCvdBySymbol.has(normalized)) {
      state.cumulativeCvdBySymbol.set(normalized, 0);
    }
  }

  if (state.symbols.size !== before && state.running) {
    restartConnections('symbol_set_updated');
  }
}

function getRealtimeSignalContext(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    return {
      status: 'UNAVAILABLE',
      stale: true
    };
  }

  const nowMs = Date.now();
  const book = state.bookTickerBySymbol.get(normalized) || null;
  const bucket = state.tradeBucketsBySymbol.get(normalized) || { trades: [] };
  pruneTradeBuckets(normalized, nowMs);

  const trades = bucket.trades || [];
  const now = Date.now();
  const trades1m = trades.filter((item) => now - item.ts <= 60 * 1000);
  const trades5m = trades.filter((item) => now - item.ts <= 5 * 60 * 1000);
  const trades15m = trades.filter((item) => now - item.ts <= 15 * 60 * 1000);

  let buyQuote = 0;
  let sellQuote = 0;
  for (const trade of trades1m) {
    if (trade.isBuyerMaker) {
      sellQuote += trade.quote;
    } else {
      buyQuote += trade.quote;
    }
  }

  const totalQuote = buyQuote + sellQuote;
  const tradeImbalance = totalQuote > 0 ? (buyQuote - sellQuote) / totalQuote : 0;

  const spreadPct = (book && Number.isFinite(book.bidPrice) && Number.isFinite(book.askPrice) && (book.bidPrice + book.askPrice) > 0)
    ? ((book.askPrice - book.bidPrice) / ((book.askPrice + book.bidPrice) / 2)) * 100
    : null;

  const bidQty = Number(book?.bidQty || 0);
  const askQty = Number(book?.askQty || 0);
  const qtyTotal = bidQty + askQty;
  const bookImbalancePct = qtyTotal > 0 ? ((bidQty - askQty) / qtyTotal) * 100 : 0;

  const lastUpdateTs = Number(book?.eventTime || 0);
  const stale = !lastUpdateTs || (nowMs - lastUpdateTs > STALE_AFTER_MS);

  const sumSigned = (windowTrades) => windowTrades.reduce((sum, trade) => sum + Number(trade.signedQuote || 0), 0);
  const cvd1m = sumSigned(trades1m);
  const cvd5m = sumSigned(trades5m);
  const cvd15m = sumSigned(trades15m);

  const first15mPrice = Number(trades15m[0]?.price || 0);
  const last15mPrice = Number(trades15m[trades15m.length - 1]?.price || 0);
  const priceChange15mPct = (first15mPrice > 0 && last15mPrice > 0)
    ? ((last15mPrice - first15mPrice) / first15mPrice) * 100
    : 0;

  const cvdDivergence = (() => {
    if (Math.abs(cvd15m) < 1) return 'NONE';
    if (priceChange15mPct > 0.18 && cvd15m < 0) return 'BEARISH';
    if (priceChange15mPct < -0.18 && cvd15m > 0) return 'BULLISH';
    return 'NONE';
  })();

  const cumulativeCvd = Number(state.cumulativeCvdBySymbol.get(normalized) || 0);
  const cvdSlope15m = cvd15m / Math.max(1, trades15m.length);

  return {
    status: stale ? 'STALE' : 'LIVE',
    stale,
    lastUpdateTs: lastUpdateTs || null,
    spreadPct: Number.isFinite(spreadPct) ? Number(spreadPct.toFixed(5)) : null,
    tradeImbalance1m: Number(tradeImbalance.toFixed(4)),
    buyQuote1m: Number(buyQuote.toFixed(2)),
    sellQuote1m: Number(sellQuote.toFixed(2)),
    tradeCount1m: trades1m.length,
    bookImbalancePct: Number(bookImbalancePct.toFixed(2)),
    cvd1m: Number(cvd1m.toFixed(2)),
    cvd5m: Number(cvd5m.toFixed(2)),
    cvd15m: Number(cvd15m.toFixed(2)),
    cumulativeCvd: Number(cumulativeCvd.toFixed(2)),
    cvdSlope15m: Number(cvdSlope15m.toFixed(4)),
    cvdDivergence,
    priceChange15mPct: Number(priceChange15mPct.toFixed(4)),
    socketState: state.lastStartReason
  };
}

function subscribeRealtimeTrades(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  state.tradeListeners.add(listener);
  return () => {
    state.tradeListeners.delete(listener);
  };
}

module.exports = {
  startRealtimeMarketData,
  stopRealtimeMarketData,
  registerRealtimeSymbols,
  getRealtimeSignalContext,
  subscribeRealtimeTrades
};
