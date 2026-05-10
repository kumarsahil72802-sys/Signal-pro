import axios from "axios";

const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
const baseURL = configuredBaseUrl || "http://localhost:5000/api";

const api = axios.create({
  baseURL,
});

export const getSignals = () => api.get("/signals/all", { params: { all: "true" } });

export const takeSignal = (id) => api.patch(`/signals/${id}/take`);

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
