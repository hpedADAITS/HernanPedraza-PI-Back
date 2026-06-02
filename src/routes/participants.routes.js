const { Router } = require('express');
const { participantsController } = require('../controllers');
const { authenticate } = require('../middleware');

const router = Router();

/* Public nickname validation for attendees before they have an auth token */
router.post(
  '/nickname/validate',
  participantsController.validateNickname.bind(participantsController),
);

/* All participant routes require authentication */
router.use(authenticate);

/* Join/leave event */
router.post(
  '/:eventId/join',
  participantsController.joinEvent.bind(participantsController),
);
router.post(
  '/:participantId/leave',
  participantsController.leaveEvent.bind(participantsController),
);
router.post(
  '/:participantId/password',
  participantsController.setPassword.bind(participantsController),
);
router.patch(
  '/:participantId/profile',
  participantsController.updateProfile.bind(participantsController),
);

/* Get participants */
router.get(
  '/:participantId',
  participantsController.getParticipant.bind(participantsController),
);
router.get(
  '/:eventId/list',
  participantsController.getEventParticipants.bind(participantsController),
);

/* Participant management */
router.put(
  '/:participantId/premium',
  participantsController.setPremium.bind(participantsController),
);
router.post(
  '/:participantId/cooldown',
  participantsController.setCooldown.bind(participantsController),
);
router.post(
  '/:participantId/kick',
  participantsController.kickParticipant.bind(participantsController),
);
router.post(
  '/:participantId/ban',
  participantsController.banParticipant.bind(participantsController),
);

module.exports = router;
