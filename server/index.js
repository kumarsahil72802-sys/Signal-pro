const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();
const connectDB = require("./config/db");
const signalRoutes = require("./routes/signalRoutes");
const marketRoutes = require("./routes/marketRoutes");
const newsRoutes = require("./routes/newsRoutes");
const { startSignalMonitor, getMonitorStatus } = require("./services/signalMonitor");
const { startSignalEngine, getEngineStatus, getDynamicThreshold } = require("./services/signalEngine");
const { initScheduler } = require("./services/scheduler");
const SystemConfig = require("./models/SystemConfig");

const app = express();

// Rate limiting: 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { status: "error", message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    const threshold = getDynamicThreshold();
    const config = await SystemConfig.findOne({ key: "confidence_threshold" });

    res.json({
      status: "ok",
      engine: getEngineStatus(),
      monitor: getMonitorStatus(),
      threshold: threshold,
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