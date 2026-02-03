const { participantsService } = require("../services");
const { logger } = require("../utils");

class ParticipantsController {
  async joinEvent(req, res) {
    try {
      const { eventId } = req.params;
      const { nickname } = req.body;

      if (!nickname) {
        return res.status(400).json({
          success: false,
          error: { code: "MISSING_NICKNAME", message: "Nickname required" },
        });
      }

      const participant = await participantsService.joinEvent(eventId, nickname);

      res.status(201).json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error("Join event error:", error);
      res.status(400).json({
        success: false,
        error: { code: "JOIN_EVENT_ERROR", message: error.message },
      });
    }
  }

  async leaveEvent(req, res) {
    try {
      const { participantId } = req.params;

      const participant = await participantsService.leaveEvent(participantId);

      res.json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error("Leave event error:", error);
      res.status(400).json({
        success: false,
        error: { code: "LEAVE_EVENT_ERROR", message: error.message },
      });
    }
  }

  async getParticipant(req, res) {
    try {
      const { participantId } = req.params;

      const participant = await participantsService.getParticipant(participantId);

      res.json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error("Get participant error:", error);
      res.status(404).json({
        success: false,
        error: { code: "PARTICIPANT_NOT_FOUND", message: error.message },
      });
    }
  }

  async getEventParticipants(req, res) {
    try {
      const { eventId } = req.params;

      const participants = await participantsService.getEventParticipants(eventId);

      res.json({
        success: true,
        data: { participants, count: participants.length },
      });
    } catch (error) {
      logger.error("Get event participants error:", error);
      res.status(400).json({
        success: false,
        error: { code: "GET_PARTICIPANTS_ERROR", message: error.message },
      });
    }
  }

  async setPremium(req, res) {
    try {
      const { participantId } = req.params;
      const { isPremium } = req.body;

      if (typeof isPremium !== "boolean") {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_PREMIUM", message: "isPremium must be boolean" },
        });
      }

      const participant = await participantsService.setPremium(participantId, isPremium);

      res.json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error("Set premium error:", error);
      res.status(400).json({
        success: false,
        error: { code: "SET_PREMIUM_ERROR", message: error.message },
      });
    }
  }

  async setCooldown(req, res) {
    try {
      const { participantId } = req.params;
      const { durationMs, reason } = req.body;

      if (!durationMs || !reason) {
        return res.status(400).json({
          success: false,
          error: { code: "MISSING_FIELDS", message: "durationMs and reason required" },
        });
      }

      const participant = await participantsService.setParticipantCooldown(
        participantId,
        durationMs,
        reason,
        req.user.userId
      );

      res.json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error("Set cooldown error:", error);
      res.status(400).json({
        success: false,
        error: { code: "SET_COOLDOWN_ERROR", message: error.message },
      });
    }
  }

  async kickParticipant(req, res) {
    try {
      const { participantId } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: { code: "MISSING_REASON", message: "Reason required" },
        });
      }

      const participant = await participantsService.kickParticipant(
        participantId,
        reason,
        req.user.userId
      );

      res.json({
        success: true,
        data: { participant },
      });
    } catch (error) {
      logger.error("Kick participant error:", error);
      res.status(400).json({
        success: false,
        error: { code: "KICK_ERROR", message: error.message },
      });
    }
  }
}

module.exports = new ParticipantsController();
