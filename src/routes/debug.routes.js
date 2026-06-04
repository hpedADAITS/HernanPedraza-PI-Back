const { Router } = require('express');
const config = require('../config');
const debugController = require('../controllers/debug.controller');
const { NotFoundError } = require('../errors');

const router = Router();

if (config.env === 'production') {
  router.get('/', (req, res) => {
    res.status(404).json({ error: 'Debug disabled in production' });
  });
}

function isDebugRouteEnabled() {
  return process.env.DEBUG_MODE === 'true' && process.env.NODE_ENV !== 'production';
}

router.use((req, res, next) => {
  if (isDebugRouteEnabled()) {
    return next();
  }

  return next(new NotFoundError('Debug routes are disabled'));
});

router.get(
  '/audio-fingerprint-stats',
  debugController.getAudioFingerprintStats.bind(debugController),
);

router.post(
  '/mock-accounts',
  debugController.createMockAccounts.bind(debugController),
);

module.exports = router;
