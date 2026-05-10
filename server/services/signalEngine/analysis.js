const indicators = require('./analysisParts/indicators');
const trend = require('./analysisParts/trend');
const scoring = require('./analysisParts/scoring');
const sentiment = require('./analysisParts/sentiment');
const futuresSignals = require('./analysisParts/futuresSignals');
const supportResistance = require('./analysisParts/supportResistance');
const adxEngine = require('./analysisParts/adxEngine');
const marketStructure = require('./analysisParts/marketStructure');
const regimeEngine = require('./analysisParts/regimeEngine');
const cvdEngine = require('./analysisParts/cvdEngine');
const liquidationPressure = require('./analysisParts/liquidationPressure');
const confidenceCalibration = require('./analysisParts/confidenceCalibration');

module.exports = {
  ...sentiment,
  ...indicators,
  ...trend,
  ...scoring,
  ...futuresSignals,
  ...supportResistance,
  ...adxEngine,
  ...marketStructure,
  ...regimeEngine,
  ...cvdEngine,
  ...liquidationPressure,
  ...confidenceCalibration
};
