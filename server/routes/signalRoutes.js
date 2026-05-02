const express = require('express');
const router = express.Router();
const { requireWriteAuth } = require('../middleware/requireWriteAuth');
const {
  createSignal,
  getActiveSignals,
  getAllSignals,
  takeSignal,
  missSignal,
  getStats
} = require('../controllers/signalController');

router.post('/', requireWriteAuth, createSignal);
router.get('/', getActiveSignals);
router.get('/all', getAllSignals);
router.get('/stats', getStats);
router.patch('/:id/take', requireWriteAuth, takeSignal);
router.patch('/:id/miss', requireWriteAuth, missSignal);

module.exports = router;
