const { Router } = require('express');
const { attendeeSessionController } = require('../controllers');

const router = Router();

router.post(
  '/events/:eventId/join',
  attendeeSessionController.joinEvent.bind(attendeeSessionController),
);

module.exports = router;
