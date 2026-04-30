const express = require('express');
const router = express.Router();
const { getCryptoNews } = require('../controllers/newsController');

router.get('/', getCryptoNews);

module.exports = router;
