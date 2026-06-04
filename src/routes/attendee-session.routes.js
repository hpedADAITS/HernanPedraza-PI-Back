const { Router } = require('express');
const { authenticate } = require('../middleware');
const { attendeeSessionController } = require('../controllers');

const router = Router();

router.post(
  '/events/:eventId/join',
  attendeeSessionController.joinEvent.bind(attendeeSessionController),
);

router.post(
  '/mark-tutorial-seen',
  authenticate,
  attendeeSessionController.markTutorialAsSeen.bind(attendeeSessionController),
);

module.exports = router;
