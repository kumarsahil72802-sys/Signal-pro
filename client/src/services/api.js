import axios from "axios";

const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
const baseURL = configuredBaseUrl || "http://localhost:5000/api";
const AUTH_TOKEN_KEY = "signal.auth.token.v1";

function readStoredToken() {
  try {
    return String(localStorage.getItem(AUTH_TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

let authToken = readStoredToken();

const api = axios.create({
  baseURL,
});

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${authToken}`,
    };
  }
  return config;
});

export function setAuthToken(token) {
  authToken = String(token || "").trim();
  try {
    if (authToken) {
      localStorage.setItem(AUTH_TOKEN_KEY, authToken);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // no-op for blocked storage environments
  }
}

export function clearAuthToken() {
  setAuthToken("");
}

export function getAuthToken() {
  return authToken;
}

export const login = (email, password) => api.post("/auth/login", { email, password });
export const getAuthMe = () => api.get("/auth/me");

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
