import axios from "axios";

const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
const baseURL = configuredBaseUrl || "http://localhost:5000/api";
const writeApiKey = String(import.meta.env.VITE_SIGNAL_WRITE_API_KEY || "").trim();

const api = axios.create({
  baseURL,
});

api.interceptors.request.use((config) => {
  if (writeApiKey) {
    const method = String(config.method || "get").toLowerCase();
    if (method !== "get" && method !== "head" && method !== "options") {
      config.headers = {
        ...config.headers,
        "x-api-key": writeApiKey,
      };
    }
  }
  return config;
});

export const getSignals = () => api.get("/signals/all");

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
