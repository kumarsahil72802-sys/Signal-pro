const core = require('./generatorParts/core');
const orderBook = require('./generatorParts/orderBook');
const { generateSignalForCoin } = require('./generatorParts/generateSignalForCoin');

module.exports = {
  ...core,
  ...orderBook,
  generateSignalForCoin
};
