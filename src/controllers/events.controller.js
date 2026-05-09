const { eventsService, authService } = require('../services');
const { logger } = require('../utils');
const { httpStatus } = require('../constants');
const { eventsValidator } = require('../validators');
const { eventsDtos } = require('../dtos');
const { ValidationError } = require('../errors');

class EventsController {
  async createEvent(req, res, next) {
    try {
      const dto = eventsDtos.toCreateEventDTO(req.body);

      eventsValidator.validateCreateEvent(dto);

      // Check if user's email is registered (for DJ users)
      const user = await authService.getCurrentUser(req.user.userId);
      if (user.role === 'DJ' && !user.emailRegistered) {
        throw new ValidationError(
          'Please confirm your email before creating an event. Check your inbox for the welcome email.'
        );
      }

      const event = await eventsService.createEvent(
        req.user.userId,
        dto.name,
        dto.description,
        dto.startsAt,
        dto.eventId,
      );

      res.status(httpStatus.CREATED).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error('Create event error:', error);
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
      logger.error('Get event error:', error);
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
      logger.error('Get event by access code error:', error);
      next(error);
    }
  }

  async listActiveEvents(req, res, next) {
    try {
      const { limit = 50, skip = 0 } = req.query;

      const events = await eventsService.listActiveEvents(
        parseInt(limit),
        parseInt(skip),
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { events, total: events.length },
      });
    } catch (error) {
      logger.error('List events error:', error);
      next(error);
    }
  }

  async updateEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      const dto = eventsDtos.toUpdateEventDTO(req.body);

      eventsValidator.validateUpdateEvent(dto);

      const event = await eventsService.updateEvent(
        eventId,
        req.user.userId,
        dto,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error('Update event error:', error);
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
      logger.error('Start event error:', error);
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
      logger.error('End event error:', error);
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
        reason,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error('Cancel event error:', error);
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
      logger.error('Get participants error:', error);
      next(error);
    }
  }

  async regenerateAccessCode(req, res, next) {
    try {
      const { eventId } = req.params;

      const event = await eventsService.regenerateAccessCode(
        eventId,
        req.user.userId,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error('Regenerate access code error:', error);
      next(error);
    }
  }
}

module.exports = new EventsController();
