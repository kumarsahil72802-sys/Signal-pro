const lastSignalTimes = new Map();

let lastLearningCheck = 0;
let engineRunning = false;
let engineStartTime = null;
let engineTickInProgress = false;

function getLastLearningCheck() {
  return lastLearningCheck;
}

function setLastLearningCheck(value) {
  lastLearningCheck = value;
}

function isEngineRunning() {
  return engineRunning;
}

function setEngineRunning(value) {
  engineRunning = value;
}

function getEngineStartTime() {
  return engineStartTime;
}

function setEngineStartTime(value) {
  engineStartTime = value;
}

function isEngineTickInProgress() {
  return engineTickInProgress;
}

function setEngineTickInProgress(value) {
  engineTickInProgress = value;
}

module.exports = {
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
