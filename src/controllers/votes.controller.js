const { votesService } = require("../services");
const { logger } = require("../utils");

class VotesController {
  async castVote(req, res) {
    try {
      const { songId, participantId, value } = req.body;

      if (!songId || !participantId || value === undefined) {
        return res.status(400).json({
          success: false,
          error: { code: "MISSING_FIELDS", message: "songId, participantId, value required" },
        });
      }

      const vote = await votesService.castVote(songId, participantId, value);

      res.status(201).json({
        success: true,
        data: { vote },
      });
    } catch (error) {
      logger.error("Cast vote error:", error);
      res.status(400).json({
        success: false,
        error: { code: "CAST_VOTE_ERROR", message: error.message },
      });
    }
  }

  async removeVote(req, res) {
    try {
      const { songId, participantId } = req.params;

      await votesService.removeVote(songId, participantId);

      res.json({
        success: true,
        data: { message: "Vote removed" },
      });
    } catch (error) {
      logger.error("Remove vote error:", error);
      res.status(404).json({
        success: false,
        error: { code: "VOTE_NOT_FOUND", message: error.message },
      });
    }
  }

  async getVoteStats(req, res) {
    try {
      const { eventId } = req.params;

      const stats = await votesService.getVoteStats(eventId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      logger.error("Get vote stats error:", error);
      res.status(400).json({
        success: false,
        error: { code: "GET_STATS_ERROR", message: error.message },
      });
    }
  }

  async getParticipantVote(req, res) {
    try {
      const { songId, participantId } = req.params;

      const vote = await votesService.getParticipantVote(songId, participantId);

      res.json({
        success: true,
        data: { vote },
      });
    } catch (error) {
      logger.error("Get participant vote error:", error);
      res.status(400).json({
        success: false,
        error: { code: "GET_VOTE_ERROR", message: error.message },
      });
    }
  }
}

module.exports = new VotesController();
