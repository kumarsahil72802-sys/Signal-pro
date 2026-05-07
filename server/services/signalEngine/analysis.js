const indicators = require('./analysisParts/indicators');
const trend = require('./analysisParts/trend');
const scoring = require('./analysisParts/scoring');
const sentiment = require('./analysisParts/sentiment');

module.exports = {
  ...sentiment,
  ...indicators,
  ...trend,
  ...scoring
};
