const { Router } = require('express');
const debugController = require('../controllers/debug.controller');
const { NotFoundError } = require('../errors');

const router = Router();

router.use((req, res, next) => {
  if (process.env.DEBUG_MODE === 'true') {
    return next();
  }

  return next(new NotFoundError('Debug routes are disabled'));
});

router.post(
  '/mock-accounts',
  debugController.createMockAccounts.bind(debugController),
);

module.exports = router;
