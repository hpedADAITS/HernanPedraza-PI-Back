const { eventsService } = require("../services");
const { logger } = require("../utils");

class EventsController {
  async createEvent(req, res) {
    try {
      const { name, description, startsAt } = req.body;

      if (!name || !startsAt) {
        return res.status(400).json({
          success: false,
          error: { code: "MISSING_FIELDS", message: "Name and startsAt required" },
        });
      }

      const event = await eventsService.createEvent(req.user.userId, name, description, startsAt);

      res.status(201).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Create event error:", error);
      res.status(400).json({
        success: false,
        error: { code: "CREATE_EVENT_ERROR", message: error.message },
      });
    }
  }

  async getEvent(req, res) {
    try {
      const { eventId } = req.params;

      const event = await eventsService.getEvent(eventId);

      res.json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Get event error:", error);
      res.status(404).json({
        success: false,
        error: { code: "EVENT_NOT_FOUND", message: error.message },
      });
    }
  }

  async getEventByAccessCode(req, res) {
    try {
      const { accessCode } = req.params;

      const event = await eventsService.getEventByAccessCode(accessCode);

      res.json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Get event by access code error:", error);
      res.status(404).json({
        success: false,
        error: { code: "EVENT_NOT_FOUND", message: error.message },
      });
    }
  }

  async listActiveEvents(req, res) {
    try {
      const { limit = 50, skip = 0 } = req.query;

      const events = await eventsService.listActiveEvents(parseInt(limit), parseInt(skip));

      res.json({
        success: true,
        data: { events, total: events.length },
      });
    } catch (error) {
      logger.error("List events error:", error);
      res.status(400).json({
        success: false,
        error: { code: "LIST_EVENTS_ERROR", message: error.message },
      });
    }
  }

  async updateEvent(req, res) {
    try {
      const { eventId } = req.params;
      const updates = req.body;

      const event = await eventsService.updateEvent(eventId, req.user.userId, updates);

      res.json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Update event error:", error);
      const statusCode = error.message === "Unauthorized" ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: { code: "UPDATE_EVENT_ERROR", message: error.message },
      });
    }
  }

  async startEvent(req, res) {
    try {
      const { eventId } = req.params;

      const event = await eventsService.startEvent(eventId, req.user.userId);

      res.json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Start event error:", error);
      const statusCode = error.message === "Unauthorized" ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: { code: "START_EVENT_ERROR", message: error.message },
      });
    }
  }

  async endEvent(req, res) {
    try {
      const { eventId } = req.params;

      const event = await eventsService.endEvent(eventId, req.user.userId);

      res.json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("End event error:", error);
      const statusCode = error.message === "Unauthorized" ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: { code: "END_EVENT_ERROR", message: error.message },
      });
    }
  }

  async cancelEvent(req, res) {
    try {
      const { eventId } = req.params;
      const { reason } = req.body;

      const event = await eventsService.cancelEvent(eventId, req.user.userId, reason);

      res.json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Cancel event error:", error);
      const statusCode = error.message === "Unauthorized" ? 403 : 400;
      res.status(statusCode).json({
        success: false,
        error: { code: "CANCEL_EVENT_ERROR", message: error.message },
      });
    }
  }

  async getParticipants(req, res) {
    try {
      const { eventId } = req.params;

      const participants = await eventsService.getEventParticipants(eventId);
      const count = await eventsService.getEventParticipantCount(eventId);

      res.json({
        success: true,
        data: { participants, count },
      });
    } catch (error) {
      logger.error("Get participants error:", error);
      res.status(400).json({
        success: false,
        error: { code: "GET_PARTICIPANTS_ERROR", message: error.message },
      });
    }
  }
}

module.exports = new EventsController();
