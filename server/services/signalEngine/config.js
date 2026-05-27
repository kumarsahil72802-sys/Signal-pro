const { settings } = require('./configParts/settings');
const {
  parseTopSelector,
  normalizeCoinToken,
  dedupeCoins,
  filterStableBasePairs,
  getTradableUsdtSymbolSet,
  resolveCoins,
  resolveCoinsDetailed
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
  setEngineTickInProgress,
  getLearningDiagnostics,
  setLearningDiagnostics
} = require('./configParts/runtimeState');

module.exports = {
  settings,
  parseTopSelector,
  normalizeCoinToken,
  dedupeCoins,
  filterStableBasePairs,
  getTradableUsdtSymbolSet,
  resolveCoins,
  resolveCoinsDetailed,
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
  setEngineTickInProgress,
  getLearningDiagnostics,
  setLearningDiagnostics
};
