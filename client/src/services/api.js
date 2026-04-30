import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

export const getSignals = () => api.get("/signals");

export const takeSignal = (id) => api.patch(`/signals/${id}/take`);

export const missSignal = (id) => api.patch(`/signals/${id}/miss`);

export const getMarketData = () => api.get("/market");

export const getNews = () => api.get("/news");

export const getStats = () => api.get("/signals/stats");
