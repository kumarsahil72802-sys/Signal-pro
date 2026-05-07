const { settings } = require('./configParts/settings');
const {
  parseTopSelector,
  normalizeCoinToken,
  dedupeCoins,
  filterStableBasePairs,
  getTradableUsdtSymbolSet,
  resolveCoins
} = require('./configParts/coinResolver');
const {
  loadThresholdFromDB,
  saveThresholdToDB,
  getConfidenceThreshold,
  getEffectiveConfidenceThreshold,
  updateConfidenceThreshold
} = require('./configParts/thresholdStore');
const {
  lastSignalTimes,
  getLastLearningCheck,
  setLastLearningCheck,
  isEngineRunning,
  setEngineRunning,
  getEngineStartTime,
  setEngineStartTime,
  isEngineTickInProgress,
  setEngineTickInProgress
} = require('./configParts/runtimeState');

module.exports = {
  settings,
  parseTopSelector,
  normalizeCoinToken,
  dedupeCoins,
  filterStableBasePairs,
  getTradableUsdtSymbolSet,
  resolveCoins,
  loadThresholdFromDB,
  saveThresholdToDB,
  getConfidenceThreshold,
  getEffectiveConfidenceThreshold,
  updateConfidenceThreshold,
  lastSignalTimes,
  getLastLearningCheck,
  setLastLearningCheck,
  isEngineRunning,
  setEngineRunning,
  getEngineStartTime,
  setEngineStartTime,
  isEngineTickInProgress,
  setEngineTickInProgress
};
