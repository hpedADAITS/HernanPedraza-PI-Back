const { Router } = require('express');
const ping = require('./ping');
const authRoutes = require('./auth.routes');
const eventsRoutes = require('./events.routes');
const songsRoutes = require('./songs.routes');
const participantsRoutes = require('./participants.routes');
const attendeeSessionRoutes = require('./attendee-session.routes');
const votesRoutes = require('./votes.routes');
const debugRoutes = require('./debug.routes');

const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SyncRekuest API',
    version: 'v1',
    timestamp: new Date().toISOString(),
  });
});

router.head('/', (req, res) => {
  res.status(200).end();
});

/* Health check */
router.use('/ping', ping);

/* API Routes */
router.use('/auth', authRoutes);
router.use('/events', eventsRoutes);
router.use('/songs', songsRoutes);
router.use('/participants', participantsRoutes);
router.use('/attendee-session', attendeeSessionRoutes);
router.use('/votes', votesRoutes);
router.use('/debug', debugRoutes);

module.exports = router;
