const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const connectDB = require("./config/db");
const signalRoutes = require("./routes/signalRoutes");
const marketRoutes = require("./routes/marketRoutes");
const newsRoutes = require("./routes/newsRoutes");
const { startSignalMonitor, getMonitorStatus } = require("./services/signalMonitor");
const { startSignalEngine, getEngineStatus, getDynamicThreshold, getLearningDiagnostics } = require("./services/signalEngine");
const { initScheduler } = require("./services/scheduler");
const { enforceSignalRetentionPolicy } = require("./services/signalRetentionService");
const SystemConfig = require("./models/SystemConfig");
const { buildWinrateDiagnostics } = require("./services/winrateDiagnosticsService");
const { settings } = require("./services/signalEngine/config");

const app = express();

const isProduction = process.env.NODE_ENV === "production";
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || (isProduction ? 300 : 2000));
const allowedOrigins = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

// Rate limiting: configurable for polling-heavy dashboards
const limiter = rateLimit({
  windowMs: rateLimitWindowMs,
  max: rateLimitMax,
  message: { status: "error", message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health",
});
app.use(limiter);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    return callback(null, allowedOrigins.includes(origin));
  }
}));
app.use(express.json());

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    const threshold = getDynamicThreshold();
    const config = await SystemConfig.findOne({ key: "confidence_threshold" });
    const cachedLearningDiagnostics = getLearningDiagnostics();
    const diagnostics = cachedLearningDiagnostics || await buildWinrateDiagnostics();

    res.json({
      status: "ok",
      engine: getEngineStatus(),
      monitor: getMonitorStatus(),
      threshold: threshold,
      baselineWinRate: diagnostics.baselineWinRate,
      deltaWinRate: diagnostics.deltaWinRate,
      rollingSampleSize: diagnostics.rollingSampleSize,
      segmentHealthSummary: diagnostics.segmentHealthSummary || null,
      sentimentEngineStatus: settings.SIGNAL_SENTIMENT_ENABLED ? 'ENABLED' : 'DISABLED',
      lastUpdated: config?.updatedAt || new Date(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get("/", (req, res) => {
  res.send("Signal Backend Running...");
});

app.use("/api/signals", signalRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/news", newsRoutes);

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ message: "Internal server error" });
});

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  await enforceSignalRetentionPolicy();
  startSignalMonitor();
  await startSignalEngine();
  initScheduler();

  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to connect to database:", err.message);
  process.exit(1);
});
