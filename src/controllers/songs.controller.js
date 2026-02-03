const { songsService } = require("../services");
const { logger } = require("../utils");

class SongsController {
  async suggestSong(req, res) {
    try {
      const { eventId } = req.params;
      const { participantId, title, artist } = req.body;

      if (!participantId || !title || !artist) {
        return res.status(400).json({
          success: false,
          error: { code: "MISSING_FIELDS", message: "participantId, title, artist required" },
        });
      }

      const song = await songsService.suggestSong(eventId, participantId, title, artist);

      res.status(201).json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error("Suggest song error:", error);
      res.status(400).json({
        success: false,
        error: { code: "SUGGEST_SONG_ERROR", message: error.message },
      });
    }
  }

  async getQueue(req, res) {
    try {
      const { eventId } = req.params;

      const songs = await songsService.getQueueForEvent(eventId);

      res.json({
        success: true,
        data: { queue: songs },
      });
    } catch (error) {
      logger.error("Get queue error:", error);
      res.status(400).json({
        success: false,
        error: { code: "GET_QUEUE_ERROR", message: error.message },
      });
    }
  }

  async getPendingSongs(req, res) {
    try {
      const { eventId } = req.params;

      const songs = await songsService.getPendingSongsForEvent(eventId);

      res.json({
        success: true,
        data: { pending: songs },
      });
    } catch (error) {
      logger.error("Get pending songs error:", error);
      res.status(400).json({
        success: false,
        error: { code: "GET_PENDING_ERROR", message: error.message },
      });
    }
  }

  async approveSong(req, res) {
    try {
      const { eventId, songId } = req.params;

      const song = await songsService.approveSong(songId, eventId, req.user.userId);

      res.json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error("Approve song error:", error);
      res.status(400).json({
        success: false,
        error: { code: "APPROVE_SONG_ERROR", message: error.message },
      });
    }
  }

  async rejectSong(req, res) {
    try {
      const { eventId, songId } = req.params;
      const { reason } = req.body;

      const song = await songsService.rejectSong(songId, eventId, reason, req.user.userId);

      res.json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error("Reject song error:", error);
      res.status(400).json({
        success: false,
        error: { code: "REJECT_SONG_ERROR", message: error.message },
      });
    }
  }

  async skipSong(req, res) {
    try {
      const { eventId, songId } = req.params;
      const { reason } = req.body;

      const song = await songsService.skipSong(songId, eventId, reason, req.user.userId);

      res.json({
        success: true,
        data: { song },
      });
    } catch (error) {
      logger.error("Skip song error:", error);
      res.status(400).json({
        success: false,
        error: { code: "SKIP_SONG_ERROR", message: error.message },
      });
    }
  }

  async getSongPosition(req, res) {
    try {
      const { songId } = req.params;

      const data = await songsService.getSongPosition(songId);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      logger.error("Get song position error:", error);
      res.status(404).json({
        success: false,
        error: { code: "SONG_NOT_FOUND", message: error.message },
      });
    }
  }
}

module.exports = new SongsController();
