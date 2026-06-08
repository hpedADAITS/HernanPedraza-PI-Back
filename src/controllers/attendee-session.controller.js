const { attendeeSessionService, songsService, votesService } = require('../services');
const { participantsSchema } = require('../schemas');
const { httpStatus } = require('../constants');
const { logger } = require('../utils');

let io = null;

class AttendeeSessionController {
  setIO(socketIO) {
    io = socketIO;
  }

  async emitQueueUpdated(eventId) {
    if (!io || !eventId) return;
    const snapshot = await songsService.getQueueSnapshotForEvent(eventId);
    io.to(`event:${eventId}`).emit('queue_updated', {
      eventId,
      ...snapshot,
      timestamp: new Date().toISOString(),
    });
  }

  async recheckVoteThresholds(eventId) {
    if (!eventId) return;
    const result = await votesService.recomputeActiveSongsForEvent(eventId);
    for (const song of result.changedSongs || []) {
      io?.to(`event:${eventId}`).emit('votes_updated', {
        eventId,
        songId: song.id || song._id,
        voteScore: song.voteScore,
        downvoteCount: song.downvoteCount,
        voteCount: song.voteCount,
        status: song.status,
        timestamp: new Date().toISOString(),
      });
    }
    for (const song of result.rejectedSongs || []) {
      io?.to(`event:${eventId}`).emit('song_rejected', {
        eventId,
        songId: song.id || song._id,
        title: song.title,
        artist: song.artist,
        status: song.status,
        reason: song.removalReason || 'Rejected by downvotes',
        timestamp: new Date().toISOString(),
      });
    }
    if ((result.changedSongs || []).length > 0 || (result.rejectedSongs || []).length > 0) {
      await this.emitQueueUpdated(eventId);
    }
  }

  async joinEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      const data = participantsSchema.parseJoinEvent(req.body);
      const session = await attendeeSessionService.joinEvent(
        eventId,
        data.nickname,
        data.profilePicture,
        data.password,
        {
          socialPrefs: data.socialPrefs,
          onDuplicateActive: (participant) => {
            if (!io) return;
            io.to(`event:${eventId}`).emit('attendee_password_prompt_requested', {
              participantId: participant._id,
              nickname: participant.nickname,
              reason: 'duplicate-login',
              requestedAt: new Date().toISOString(),
            });
          },
        },
      );

      await this.recheckVoteThresholds(eventId);

      res.status(httpStatus.CREATED).json({
        success: true,
        data: session,
      });
    } catch (error) {
      logger.error('Attendee session join error:', error);
      next(error);
    }
  }

  async markTutorialAsSeen(req, res, next) {
    try {
      const result = await attendeeSessionService.markTutorialAsSeen(req.user.userId);

      res.status(httpStatus.OK).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Mark tutorial as seen error:', error);
      next(error);
    }
  }
}

module.exports = new AttendeeSessionController();
