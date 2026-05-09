const express = require('express');
const { login, me } = require('../controllers/authController');

const router = express.Router();

router.post('/login', login);
router.get('/me', me);

module.exports = router;
