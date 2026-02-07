const { votesService } = require("../services");
const { logger } = require("../utils");
const { httpStatus, messages } = require("../constants");
const { ValidationError } = require("../errors");

class VotesController {
  async castVote(req, res, next) {
    try {
      const { songId, participantId, value } = req.body;

      if (!songId || !participantId || value === undefined) {
        throw new ValidationError(messages.VALIDATION.REQUIRED_FIELD);
      }

      const vote = await votesService.castVote(songId, participantId, value);

      res.status(httpStatus.CREATED).json({
        success: true,
        data: { vote },
      });
    } catch (error) {
      logger.error("Cast vote error:", error);
      next(error);
    }
  }

  async removeVote(req, res, next) {
    try {
      const { songId, participantId } = req.params;

      await votesService.removeVote(songId, participantId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { message: "Vote removed" },
      });
    } catch (error) {
      logger.error("Remove vote error:", error);
      next(error);
    }
  }

  async getVoteStats(req, res, next) {
    try {
      const { eventId } = req.params;

      const stats = await votesService.getVoteStats(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error("Get vote stats error:", error);
      next(error);
    }
  }

  async getParticipantVote(req, res, next) {
    try {
      const { songId, participantId } = req.params;

      const vote = await votesService.getParticipantVote(songId, participantId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { vote },
      });
    } catch (error) {
      logger.error("Get participant vote error:", error);
      next(error);
    }
  }
}

module.exports = new VotesController();
