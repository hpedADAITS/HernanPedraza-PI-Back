const { Router } = require('express');
const ping = require('./ping');
const authRoutes = require('./auth.routes');
const eventsRoutes = require('./events.routes');
const songsRoutes = require('./songs.routes');
const participantsRoutes = require('./participants.routes');
const votesRoutes = require('./votes.routes');

const router = Router();

/* Health check */
router.use('/ping', ping);

/* API Routes */
router.use('/auth', authRoutes);
router.use('/events', eventsRoutes);
router.use('/songs', songsRoutes);
router.use('/participants', participantsRoutes);
router.use('/votes', votesRoutes);

module.exports = router;
