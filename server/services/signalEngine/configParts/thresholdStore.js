const SystemConfig = require('../../../models/SystemConfig');
const { settings } = require('./settings');

const {
  CONFIDENCE_THRESHOLD_KEY,
  DEFAULT_MIN_CONFIDENCE,
  SIGNAL_THRESHOLD_OFFSET
} = settings;

let cachedMinConfidence = DEFAULT_MIN_CONFIDENCE;

async function loadThresholdFromDB() {
  try {
    const storedValue = await SystemConfig.getValue(CONFIDENCE_THRESHOLD_KEY);
    if (storedValue !== null && typeof storedValue === 'number') {
      cachedMinConfidence = storedValue;
      console.log(`[Config] Loaded confidence threshold from DB: ${cachedMinConfidence}`);
    } else {
      await SystemConfig.setValue(CONFIDENCE_THRESHOLD_KEY, DEFAULT_MIN_CONFIDENCE);
      cachedMinConfidence = DEFAULT_MIN_CONFIDENCE;
      console.log(`[Config] Initialized confidence threshold: ${DEFAULT_MIN_CONFIDENCE}`);
    }
  } catch (error) {
    console.error(`[Config] Failed to load threshold from DB: ${error.message}`);
    console.log(`[Config] Using fallback threshold: ${cachedMinConfidence}`);
  }
}

async function saveThresholdToDB(value) {
  try {
    await SystemConfig.setValue(CONFIDENCE_THRESHOLD_KEY, value);
    return true;
  } catch (error) {
    console.error(`[Config] Failed to save threshold to DB: ${error.message}`);
    return false;
  }
}

function getConfidenceThreshold() {
  return cachedMinConfidence;
}

function getEffectiveConfidenceThreshold() {
  const effective = getConfidenceThreshold() + SIGNAL_THRESHOLD_OFFSET;
  return Math.max(50, Math.min(90, Math.round(effective)));
}

async function updateConfidenceThreshold(newValue) {
  cachedMinConfidence = newValue;
  await saveThresholdToDB(newValue);
}

module.exports = {
  loadThresholdFromDB,
  saveThresholdToDB,
  getConfidenceThreshold,
  getEffectiveConfidenceThreshold,
  updateConfidenceThreshold
};
