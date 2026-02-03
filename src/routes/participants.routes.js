const { Router } = require("express");
const { participantsController } = require("../controllers");
const { authenticate } = require("../middleware");

const router = Router();

// All participant routes require authentication
router.use(authenticate);

// Join/leave event
router.post("/:eventId/join", participantsController.joinEvent.bind(participantsController));
router.post("/:participantId/leave", participantsController.leaveEvent.bind(participantsController));

// Get participants
router.get("/:participantId", participantsController.getParticipant.bind(participantsController));
router.get("/:eventId/list", participantsController.getEventParticipants.bind(participantsController));

// Participant management
router.put("/:participantId/premium", participantsController.setPremium.bind(participantsController));
router.post("/:participantId/cooldown", participantsController.setCooldown.bind(participantsController));
router.post("/:participantId/kick", participantsController.kickParticipant.bind(participantsController));

module.exports = router;
