const trigger = require('./trigger');
const higherTimeframe = require('./higherTimeframe');

module.exports = {
  ...trigger,
  ...higherTimeframe
};
