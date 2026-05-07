const core = require('./scoringCore');
const confidencePenaltyMarket = require('./confidencePenaltyMarket');

module.exports = {
  ...core,
  ...confidencePenaltyMarket
};
