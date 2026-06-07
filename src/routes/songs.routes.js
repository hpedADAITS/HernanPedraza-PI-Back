const { Router } = require('express');
const { songsController } = require('../controllers');
const { authenticate } = require('../middleware');

const router = Router();

/* All song routes require authentication */
router.use(authenticate);

/* Song management */
router.post(
  '/:eventId/suggest',
  songsController.suggestSong.bind(songsController),
);
router.post(
  '/:eventId/lookup-musicbrainz',
  songsController.lookupMusicBrainz.bind(songsController),
);
router.get(
  '/:eventId/:songId/musicbrainz-match-candidates',
  songsController.getMusicBrainzMatchCandidates.bind(songsController),
);
router.post(
  '/:eventId/:songId/assign-musicbrainz-track',
  songsController.assignMusicBrainzMetadataToTrack.bind(songsController),
);
router.post(
  '/:eventId/:songId/assign-fingerprint',
  songsController.assignFingerprintToSong.bind(songsController),
);
router.get('/:eventId/queue', songsController.getQueue.bind(songsController));
router.get(
  '/:eventId/pending',
  songsController.getPendingSongs.bind(songsController),
);

/* DJ operations */
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
router.post(
  '/:eventId/:songId/send-now',
  songsController.sendNow.bind(songsController),
);

/* Queue info */
router.get(
  '/:songId/position',
  songsController.getSongPosition.bind(songsController),
);

/* Quick actions */
router.post(
  '/:eventId/play-next',
  songsController.playNext.bind(songsController),
);

module.exports = router;
