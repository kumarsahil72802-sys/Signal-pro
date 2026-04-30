const express = require('express');
const router = express.Router();
const { getMarketOverview, getMarketQuality, getMarketChart } = require('../controllers/marketController');

router.get('/', getMarketOverview);
router.get('/quality', getMarketQuality);
router.get('/chart', getMarketChart);

module.exports = router;
