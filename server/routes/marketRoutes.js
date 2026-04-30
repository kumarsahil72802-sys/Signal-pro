const express = require('express');
const router = express.Router();
const { getMarketOverview } = require('../controllers/marketController');

router.get('/', getMarketOverview);

module.exports = router;
