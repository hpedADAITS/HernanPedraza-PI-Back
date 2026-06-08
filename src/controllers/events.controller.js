const { eventsService, songsService, votesService } = require('../services');
const { logger } = require('../utils');
const { httpStatus } = require('../constants');
const { eventsSchema } = require('../schemas');
const config = require('../config');

let io = null;

function getSafeFrontendOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';

  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : '';
  } catch {
    return '';
  }
}

function isLoopbackOrigin(origin) {
  if (!origin) return false;

  const { hostname } = new URL(origin);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

const roomForEvent = (eventId) => `event:${eventId}`;

class EventsController {
  setIO(socketIO) {
    io = socketIO;
  }

  getIO() {
    return io;
  }

  emitEventUpdate(eventId, eventName, payload) {
    if (!io || !eventId) return;
    io.to(roomForEvent(eventId)).emit(eventName, {
      eventId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }

  async emitQueueUpdated(eventId) {
    if (!io || !eventId) return;
    const snapshot = await songsService.getQueueSnapshotForEvent(eventId);
    io.to(roomForEvent(eventId)).emit('queue_updated', {
      eventId,
      ...snapshot,
      timestamp: new Date().toISOString(),
    });
  }

  emitVoteRecomputeEvents(eventId, result) {
    if (!io || !eventId || !result) return;
    for (const song of result.changedSongs || []) {
      this.emitEventUpdate(eventId, 'votes_updated', {
        songId: song.id || song._id,
        voteScore: song.voteScore,
        downvoteCount: song.downvoteCount,
        voteCount: song.voteCount,
        status: song.status,
      });
    }
    for (const song of result.rejectedSongs || []) {
      this.emitEventUpdate(eventId, 'song_rejected', {
        songId: song.id || song._id,
        title: song.title,
        artist: song.artist,
        status: song.status,
        reason: song.removalReason || 'Rejected by downvotes',
      });
    }
  }

  async createEvent(req, res, next) {
    try {
      const data = eventsSchema.parseCreateEvent(req.body);

      const event = await eventsService.createEvent(
        req.user,
        data.name,
        data.description,
        data.startsAt,
        data.eventId,
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

  async getMyActiveEvent(req, res, next) {
    try {
      const event = await eventsService.getActiveEventForOwner(req.user.userId);

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error('Get my active event error:', error);
      next(error);
    }
  }

  async updateEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      const data = eventsSchema.parseUpdateEvent(req.body);

      const event = await eventsService.updateEvent(
        eventId,
        req.user.userId,
        data,
      );

      this.emitEventUpdate(eventId, 'event_updated', { event });
      if (data.settings && data.settings.premiumVotesEnabled !== undefined) {
        const recompute = await votesService.recomputeActiveSongsForEvent(eventId);
        this.emitVoteRecomputeEvents(eventId, recompute);
        await this.emitQueueUpdated(eventId);
      }

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

      this.emitEventUpdate(eventId, 'event_updated', { event });

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

      this.emitEventUpdate(eventId, 'event_updated', { event });
      this.emitEventUpdate(eventId, 'event_ended', {
        event,
        cancelled: false,
      });

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

      this.emitEventUpdate(eventId, 'event_updated', { event });
      this.emitEventUpdate(eventId, 'event_ended', {
        event,
        cancelled: true,
        reason,
      });

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

      this.emitEventUpdate(eventId, 'event_updated', { event });
      this.emitEventUpdate(eventId, 'access_code_updated', {
        event,
        accessCode: event.accessCode,
      });

      res.status(httpStatus.OK).json({
        success: true,
        data: { event },
      });
    } catch (error) {
      logger.error('Regenerate access code error:', error);
      next(error);
    }
  }

  async getPhoneMicrophoneLink(req, res, next) {
    try {
      const { eventId } = req.params;
      const requestedOrigin = getSafeFrontendOrigin(req.query?.frontendOrigin);
      const origin = getSafeFrontendOrigin(req.get('origin'));
      const host = req.get('host');
      const requestBase = getSafeFrontendOrigin(host ? `${req.protocol}://${host}` : '');
      const frontendBase =
        requestedOrigin ||
        (!isLoopbackOrigin(origin) && origin) ||
        (!isLoopbackOrigin(requestBase) && requestBase) ||
        config.frontendUrl ||
        origin ||
        requestBase;

      const link = await eventsService.getPhoneMicrophoneLink(
        eventId,
        req.user.userId,
        req.user.role,
        frontendBase,
      );

      res.status(httpStatus.OK).json({
        success: true,
        data: { link },
      });
    } catch (error) {
      logger.error('Get phone microphone link error:', error);
      next(error);
    }
  }

  async connectPhoneMicrophone(req, res, next) {
    try {
      const { eventId } = req.params;
      const deviceName =
        typeof req.body?.deviceName === 'string' && req.body.deviceName.trim()
          ? req.body.deviceName.trim()
          : 'Phone microphone';

      const token = getPhoneMicrophoneToken(req);
      if (!token) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Phone microphone token is required' } });
      }

      const microphone = await eventsService.connectPhoneMicrophone(
        eventId,
        deviceName,
        token,
      );

      this.emitEventUpdate(eventId, 'phone_microphone_connected', {
        microphone,
      });

      res.status(httpStatus.OK).json({
        success: true,
        data: { microphone },
      });
    } catch (error) {
      logger.error('Connect phone microphone error:', error);
      next(error);
    }
  }
}

function getPhoneMicrophoneToken(req) {
  return req.body?.token || req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
}

module.exports = new EventsController();
