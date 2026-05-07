const { Router } = require('express');
const { eventsController } = require('../controllers');
const { authenticate } = require('../middleware');

const router = Router();

// All event routes require authentication
router.use(authenticate);

// Event CRUD
router.post('/', eventsController.createEvent.bind(eventsController));
router.get('/', eventsController.listActiveEvents.bind(eventsController));
router.get(
  '/access/:accessCode',
  eventsController.getEventByAccessCode.bind(eventsController),
);
router.get('/:eventId', eventsController.getEvent.bind(eventsController));
router.put('/:eventId', eventsController.updateEvent.bind(eventsController));

// Event state management
router.post(
  '/:eventId/start',
  eventsController.startEvent.bind(eventsController),
);
router.post('/:eventId/end', eventsController.endEvent.bind(eventsController));
router.post(
  '/:eventId/cancel',
  eventsController.cancelEvent.bind(eventsController),
);
router.post(
  '/:eventId/regenerate-code',
  eventsController.regenerateAccessCode.bind(eventsController),
);

// Participants
router.get(
  '/:eventId/participants',
  eventsController.getParticipants.bind(eventsController),
);

module.exports = router;
