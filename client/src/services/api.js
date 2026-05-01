import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

export const getSignals = () => api.get("/signals");

export const takeSignal = (id) => api.patch(`/signals/${id}/take`);

export const missSignal = (id) => api.patch(`/signals/${id}/miss`);

export const getMarketData = (limit = 100) => api.get("/market", { params: { limit } });
export const getMarketQuality = (symbols = []) => {
  const normalizedSymbols = Array.isArray(symbols)
    ? symbols.filter(Boolean).join(",")
    : "";
  return api.get("/market/quality", { params: { symbols: normalizedSymbols } });
};
export const getMarketChart = (symbol, interval = "15m", limit = 72) =>
  api.get("/market/chart", { params: { symbol, interval, limit } });

export const getNews = () => api.get("/news");
export const getCoinNews = (symbol, limit = 8) =>
  api.get("/news", { params: { symbol, limit } });

export const getStats = () => api.get("/signals/stats");
