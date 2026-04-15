const { Router } = require('express');
const { votesController } = require('../controllers');
const { authenticate } = require('../middleware');

const router = Router();

// All vote routes require authentication
router.use(authenticate);

// Vote operations
router.post('/', votesController.castVote.bind(votesController));
router.delete(
  '/:songId/:participantId',
  votesController.removeVote.bind(votesController),
);

// Vote stats
router.get(
  '/:eventId/stats',
  votesController.getVoteStats.bind(votesController),
);
router.get(
  '/:songId/:participantId',
  votesController.getParticipantVote.bind(votesController),
);

module.exports = router;
