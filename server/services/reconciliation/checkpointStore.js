const SystemConfig = require('../../models/SystemConfig');
const { settings } = require('../signalEngine/config');

const { SIGNAL_MONITOR_CHECKPOINT_KEY } = settings;

function toValidTimestampMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

async function getMonitorCheckpointMs() {
  try {
    const storedValue = await SystemConfig.getValue(SIGNAL_MONITOR_CHECKPOINT_KEY, null);
    return toValidTimestampMs(storedValue);
  } catch (error) {
    console.error(`[Reconcile][Checkpoint] Read failed: ${error.message}`);
    return null;
  }
}

async function setMonitorCheckpointMs(timestampMs) {
  const safeTimestamp = toValidTimestampMs(timestampMs);
  if (!safeTimestamp) return false;

  try {
    await SystemConfig.setValue(SIGNAL_MONITOR_CHECKPOINT_KEY, safeTimestamp);
    return true;
  } catch (error) {
    console.error(`[Reconcile][Checkpoint] Write failed: ${error.message}`);
    return false;
  }
}

module.exports = {
  getMonitorCheckpointMs,
  setMonitorCheckpointMs
};
