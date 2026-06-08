const { participantsService, songsService, votesService } = require('../services');
const { logger } = require('../utils');
const { httpStatus, messages } = require('../constants');
const { UnauthorizedError } = require('../errors');
const { participantsSchema } = require('../schemas');
const matchSessionRegistry = require('../services/audio-recognition/match-session-registry');

let io = null;

class ParticipantsController {
  setIO(socketIO) {
    io = socketIO;
  }

  getIO() {
    return io;
  }

  emitParticipantEvent(eventId, eventName, payload) {
    if (!io || !eventId) return;
    io.to(`event:${eventId}`).emit(eventName, payload);
  }

  async emitQueueUpdated(eventId) {
    if (!io || !eventId) return;
    const snapshot = await songsService.getQueueSnapshotForEvent(eventId);
    io.to(`event:${eventId}`).emit('queue_updated', {
      eventId,
      ...snapshot,
      timestamp: new Date().toISOString(),
    });
    await matchSessionRegistry.applyQueueEventToEvent(eventId, {
      type: 'queue_updated',
      timestamp: new Date().toISOString(),
    });
  }

  async recheckVoteThresholds(eventId) {
    if (!eventId) return;
    const result = await votesService.recomputeActiveSongsForEvent(eventId);
    for (const song of result.changedSongs || []) {
      this.emitParticipantEvent(eventId, 'votes_updated', {
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
      this.emitParticipantEvent(eventId, 'song_rejected', {
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

  async validateNickname(req, res, next) {
    try {
      const data = participantsSchema.parseJoinEvent({
        nickname: req.body.nickname,
        profilePicture: null,
      });

      await participantsService.ensureNicknameIsNotAccessCode(data.nickname);

      res.status(httpStatus.OK).json({
        success: true,
        data: { valid: true },
      });
    } catch (error) {
      logger.error('Validate nickname error:', error);
      next(error);
    }
  }

  async joinEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      const data = participantsSchema.parseJoinEvent(req.body);

      const participant = await participantsService.joinEvent(
        eventId,
        data.nickname,
        data.profilePicture,
        data.password,
        req.user.userId,
        {
          socialPrefs: data.socialPrefs,
          onDuplicateActive: (existingParticipant) => {
            if (!io) return;
            io.to(`event:${eventId}`).emit('attendee_password_prompt_requested', {
              participantId: existingParticipant._id,
              nickname: existingParticipant.nickname,
              reason: 'duplicate-login',
              requestedAt: new Date().toISOString(),
            });
          },
        },
      );

      await this.recheckVoteThresholds(eventId);

      res.status(httpStatus.CREATED).json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error('Join event error:', error);
      next(error);
    }
  }

  async leaveEvent(req, res, next) {
    try {
      const { participantId } = req.params;

      const participant = await participantsService.leaveEvent(participantId, req.user);
      await this.recheckVoteThresholds(participant.eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error('Leave event error:', error);
      next(error);
    }
  }

  async setPassword(req, res, next) {
    try {
      const { participantId } = req.params;
      const data = participantsSchema.parseSetPassword(req.body);

      const participant = await participantsService.setParticipantPassword(
        participantId,
        data.password,
        req.user,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error('Set participant password error:', error);
      next(error);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const { participantId } = req.params;
      const data = participantsSchema.parseUpdateProfile(req.body);

      const participant = await participantsService.updateProfile(
        participantId,
        data,
        req.user,
      );
      const payload = {
        eventId: participant.eventId,
        participantId: participant._id,
        nickname: participant.nickname,
        profilePicture: participant.profilePicture,
      };

      this.emitParticipantEvent(participant.eventId, 'participant_updated', payload);
      if (data.nickname !== undefined) {
        this.emitParticipantEvent(participant.eventId, 'participant_renamed', payload);
      }
      if (data.profilePicture !== undefined) {
        this.emitParticipantEvent(
          participant.eventId,
          'participant_profile_changed',
          payload,
        );
      }

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error('Update participant profile error:', error);
      next(error);
    }
  }

  async getParticipant(req, res, next) {
    try {
      const { participantId } = req.params;

      const participant =
        await participantsService.getParticipant(participantId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error('Get participant error:', error);
      next(error);
    }
  }

  async getEventParticipants(req, res, next) {
    try {
      const { eventId } = req.params;

      const participants =
        await participantsService.getEventParticipants(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { participants, count: participants.length },
      });
    } catch (error) {
      logger.error('Get event participants error:', error);
      next(error);
    }
  }

  async setPremium(req, res, next) {
    try {
      const { participantId } = req.params;
      const data = participantsSchema.parseSetPremium(req.body);

      const participant = await participantsService.setPremium(
        participantId,
        data.isPremium,
        req.user,
      );

      this.emitParticipantEvent(participant.eventId, 'participant_premium_updated', {
        participantId: participant._id,
        isPremium: participant.isPremium,
      });

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error('Set premium error:', error);
      next(error);
    }
  }

  async setCooldown(req, res, next) {
    try {
      const { participantId } = req.params;
      const data = participantsSchema.parseCooldown(req.body);

      if (!req.user?.userId) {
        throw new UnauthorizedError(messages.AUTH.UNAUTHORIZED);
      }

      const result = await participantsService.setParticipantCooldown(
        participantId,
        data.durationMs,
        data.reason,
        req.user,
      );

      this.emitParticipantEvent(result.eventId, 'participant_cooldown', {
        participantId: result.participant._id,
        reason: data.reason,
        cooldownUntil:
          result.participant.cooldownUntil instanceof Date
            ? result.participant.cooldownUntil.toISOString()
            : result.participant.cooldownUntil,
      });

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant: result.participant },
      });
    } catch (error) {
      logger.error('Set cooldown error:', error);
      next(error);
    }
  }

  async clearCooldown(req, res, next) {
    try {
      const { participantId } = req.params;

      if (!req.user?.userId) {
        throw new UnauthorizedError(messages.AUTH.UNAUTHORIZED);
      }

      const result = await participantsService.clearParticipantCooldown(
        participantId,
        req.user,
      );

      this.emitParticipantEvent(result.eventId, 'participant_cooldown_cleared', {
        participantId: result.participant._id,
      });

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant: result.participant },
      });
    } catch (error) {
      logger.error('Clear cooldown error:', error);
      next(error);
    }
  }

  async kickParticipant(req, res, next) {
    try {
      const { participantId } = req.params;
      const data = participantsSchema.parseKickParticipant(req.body);

      if (!req.user?.userId) {
        throw new UnauthorizedError(messages.AUTH.UNAUTHORIZED);
      }

      const result = await participantsService.kickParticipant(
        participantId,
        data.reason,
        req.user,
      );

      this.emitParticipantEvent(result.eventId, 'participant_kicked', {
        participantId: result.participant._id,
        reason: data.reason,
        kickedAt:
          result.participant.leftAt instanceof Date
            ? result.participant.leftAt.toISOString()
            : result.participant.leftAt,
      });
      await this.recheckVoteThresholds(result.eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant: result.participant },
      });
    } catch (error) {
      logger.error('Kick participant error:', error);
      next(error);
    }
  }

  async banParticipant(req, res, next) {
    try {
      const { participantId } = req.params;
      const data = participantsSchema.parseBanParticipant(req.body);

      if (!req.user?.userId) {
        throw new UnauthorizedError(messages.AUTH.UNAUTHORIZED);
      }

      const result = await participantsService.banParticipant(
        participantId,
        data.reason,
        req.user,
      );

      this.emitParticipantEvent(result.eventId, 'participant_banned', {
        participantId: result.participant._id,
        reason: data.reason,
        bannedAt:
          result.participant.leftAt instanceof Date
            ? result.participant.leftAt.toISOString()
            : result.participant.leftAt,
      });
      await this.recheckVoteThresholds(result.eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant: result.participant },
      });
    } catch (error) {
      logger.error('Ban participant error:', error);
      next(error);
    }
  }
}

module.exports = new ParticipantsController();
