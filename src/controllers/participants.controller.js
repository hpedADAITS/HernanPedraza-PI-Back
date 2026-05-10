const { participantsService } = require('../services');
const { logger } = require('../utils');
const { httpStatus, messages } = require('../constants');
const { UnauthorizedError } = require('../errors');
const { participantsValidator } = require('../validators');
const { participantsDtos } = require('../dtos');

let io = null; // Will be injected

/* Inject Socket.IO instance */
const setIO = (ioInstance) => {
  io = ioInstance;
};

class ParticipantsController {
  async joinEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      const dto = participantsDtos.toJoinEventDTO(req.body);
      participantsValidator.validateJoinEvent(dto);

      const participant = await participantsService.joinEvent(
        eventId,
        dto.nickname,
      );

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

      const participant = await participantsService.leaveEvent(participantId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error('Leave event error:', error);
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
      const dto = participantsDtos.toSetPremiumDTO(req.body);
      participantsValidator.validateSetPremium(dto);

      const participant = await participantsService.setPremium(
        participantId,
        dto.isPremium,
      );

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
      const dto = participantsDtos.toCooldownDTO(req.body);
      participantsValidator.validateCooldown(dto);

      const actorUserId =
        typeof req.user.userId === 'string'
          ? req.user.userId
          : req.user.userId?.toString();

      if (!actorUserId) {
        throw new UnauthorizedError(messages.AUTH.UNAUTHORIZED);
      }

      const result = await participantsService.setParticipantCooldown(
        participantId,
        dto.durationMs,
        dto.reason,
        actorUserId,
      );

      if (io) {
        io.to(`event_${result.eventId}`).emit('participant_cooldown', {
          participantId,
          cooldownUntil: result.participant.cooldownUntil,
          reason: dto.reason,
        });
      }

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant: result.participant },
      });
    } catch (error) {
      logger.error('Set cooldown error:', error);
      next(error);
    }
  }

  async kickParticipant(req, res, next) {
    try {
      const { participantId } = req.params;
      const dto = participantsDtos.toKickDTO(req.body);
      participantsValidator.validateKickParticipant(dto);

      const actorUserId =
        typeof req.user.userId === 'string'
          ? req.user.userId
          : req.user.userId?.toString();

      if (!actorUserId) {
        throw new UnauthorizedError(messages.AUTH.UNAUTHORIZED);
      }

      const result = await participantsService.kickParticipant(
        participantId,
        dto.reason,
        actorUserId,
      );

      if (io) {
        io.to(`event_${result.eventId}`).emit('participant_kicked', {
          participantId,
          kickedAt: result.participant.kickedAt,
          reason: dto.reason,
        });
      }

      res.status(httpStatus.OK).json({
        success: true,
        data: { participant: result.participant },
      });
    } catch (error) {
      logger.error('Kick participant error:', error);
      next(error);
    }
  }
}

module.exports = new ParticipantsController();
module.exports.setIO = setIO;
