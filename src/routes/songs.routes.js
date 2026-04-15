const { Router } = require('express');
const { songsController } = require('../controllers');
const { authenticate } = require('../middleware');

const router = Router();

// All song routes require authentication
router.use(authenticate);

// Song management
router.post(
  '/:eventId/suggest',
  songsController.suggestSong.bind(songsController),
);
router.get('/:eventId/queue', songsController.getQueue.bind(songsController));
router.get(
  '/:eventId/pending',
  songsController.getPendingSongs.bind(songsController),
);

// DJ operations
router.post(
  '/:eventId/:songId/approve',
  songsController.approveSong.bind(songsController),
);
router.post(
  '/:eventId/:songId/reject',
  songsController.rejectSong.bind(songsController),
);
router.post(
  '/:eventId/:songId/skip',
  songsController.skipSong.bind(songsController),
);

// Queue info
router.get(
  '/:songId/position',
  songsController.getSongPosition.bind(songsController),
);

module.exports = router;
