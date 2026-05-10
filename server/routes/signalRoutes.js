const express = require('express');
const router = express.Router();
const {
  createSignal,
  getActiveSignals,
  getAllSignals,
  takeSignal,
  missSignal,
  getStats
} = require('../controllers/signalController');

router.post('/', createSignal);
router.get('/', getActiveSignals);
router.get('/all', getAllSignals);
router.get('/stats', getStats);
router.patch('/:id/take', takeSignal);
router.patch('/:id/miss', missSignal);

module.exports = router;
