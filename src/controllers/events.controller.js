const { eventsService } = require("../services");
const { logger } = require("../utils");
const { httpStatus, messages } = require("../constants");
const { ValidationError } = require("../errors");

class EventsController {
  async createEvent(req, res, next) {
    try {
      const { name, description, startsAt } = req.body;

      if (!name || !startsAt) {
        throw new ValidationError(messages.VALIDATION.REQUIRED_FIELD);
      }

      const event = await eventsService.createEvent(
        req.user.userId,
        name,
        description,
        startsAt
      );

      res.status(httpStatus.CREATED).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Create event error:", error);
      next(error);
    }
  }

  async getEvent(req, res, next) {
    try {
      const { eventId } = req.params;

      const event = await eventsService.getEvent(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Get event error:", error);
      next(error);
    }
  }

  async getEventByAccessCode(req, res, next) {
    try {
      const { accessCode } = req.params;

      const event = await eventsService.getEventByAccessCode(accessCode);

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Get event by access code error:", error);
      next(error);
    }
  }

  async listActiveEvents(req, res, next) {
    try {
      const { limit = 50, skip = 0 } = req.query;

      const events = await eventsService.listActiveEvents(
        parseInt(limit),
        parseInt(skip)
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { events, total: events.length },
      });
    } catch (error) {
      logger.error("List events error:", error);
      next(error);
    }
  }

  async updateEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      const updates = req.body;

      const event = await eventsService.updateEvent(
        eventId,
        req.user.userId,
        updates
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Update event error:", error);
      next(error);
    }
  }

  async startEvent(req, res, next) {
    try {
      const { eventId } = req.params;

      const event = await eventsService.startEvent(eventId, req.user.userId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Start event error:", error);
      next(error);
    }
  }

  async endEvent(req, res, next) {
    try {
      const { eventId } = req.params;

      const event = await eventsService.endEvent(eventId, req.user.userId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("End event error:", error);
      next(error);
    }
  }

  async cancelEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      const { reason } = req.body;

      const event = await eventsService.cancelEvent(
        eventId,
        req.user.userId,
        reason
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error("Cancel event error:", error);
      next(error);
    }
  }

  async getParticipants(req, res, next) {
    try {
      const { eventId } = req.params;

      const participants = await eventsService.getEventParticipants(eventId);
      const count = await eventsService.getEventParticipantCount(eventId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { participants, count },
      });
    } catch (error) {
      logger.error("Get participants error:", error);
      next(error);
    }
  }
}

module.exports = new EventsController();
