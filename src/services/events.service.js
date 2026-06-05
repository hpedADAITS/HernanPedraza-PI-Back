const {
  EventModel,
  EventMemberModel,
  ParticipantModel,
  SongModel,
  UserModel,
  defaultPermissionsForRole,
} = require('../models/schema');
const eventPermissionsService = require('./event-permissions.service');
const { generateEventCode } = require('../utils/code-generator');
const { logger } = require('../utils');
const { generateToken, verifyToken } = require('../utils/jwt.utils');
const {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  ForbiddenError,
} = require('../errors');

class EventsService {
  async createEvent(actorUser, name, description, startsAt, eventId = null) {
    const ownerId = await this._assertCanCreateEvent(actorUser);
    /* Use provided eventId or generate a random one */
    const finalEventId = eventId || generateEventCode(8);
    /* Generate random accessCode (separate from eventId, regenerable) */
    const accessCode = generateEventCode(6);

    const event = new EventModel({
      name,
      description,
      ownerId,
      eventId: finalEventId,
      accessCode,
      startsAt: new Date(startsAt),
      state: 'DRAFT',
      settings: {
        allowRequests: true,
        requireApproval: false,
        votingEnabled: true,
        allowDownvotes: true,
        maxRequestsPerParticipant: 3,
      },
    });

    await event.save();

    /* Create owner as EventMember with DJ role (full permissions) */
    const eventMember = new EventMemberModel({
      eventId: event._id,
      userId: ownerId,
      role: 'DJ',
      permissions: defaultPermissionsForRole('DJ'),
      addedBy: ownerId,
    });

    await eventMember.save();

    logger.info(`Event created: ${event._id} by ${ownerId}`);

    return this._formatEvent(event);
  }

  async _assertCanCreateEvent(actorUser) {
    const userId =
      typeof actorUser === 'string'
        ? actorUser
        : actorUser?.userId?.toString() ||
          actorUser?._id?.toString() ||
          actorUser?.id?.toString();

    if (!userId) {
      throw new ForbiddenError('Only DJs can create events');
    }

    const user = await UserModel.findById(userId)
      .select('role emailRegistered')
      .lean();
    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.role !== 'DJ') {
      throw new ForbiddenError('Only DJs can create events');
    }

    if (user.role === 'DJ' && !user.emailRegistered) {
      throw new ValidationError(
        'Please confirm your email before creating an event. Check your inbox for the welcome email.'
      );
    }

    return user._id;
  }

  async getEvent(eventId) {
    const event = await EventModel.findById(eventId).populate(
      'ownerId',
      'email displayName profilePicture',
    );
    if (!event) {
      throw new NotFoundError('Event not found');
    }
    return this._formatEvent(event);
  }

  async getEventByAccessCode(accessCode) {
    const event = await EventModel.findOne({
      accessCode: accessCode.toUpperCase(),
    }).populate('ownerId', 'displayName profilePicture');
    if (!event) {
      throw new NotFoundError('Event not found');
    }
    return this._formatEvent(event);
  }

  async listActiveEvents(limit = 50, skip = 0) {
    const events = await EventModel.find({ state: 'LIVE' })
      .populate('ownerId', 'email displayName profilePicture')
      .limit(limit)
      .skip(skip)
      .sort({ startsAt: -1 });

    return events.map((e) => this._formatEvent(e));
  }

  async getActiveEventForOwner(ownerId) {
    const event = await EventModel.findOne({ ownerId, state: 'LIVE' })
      .populate('ownerId', 'email displayName profilePicture')
      .sort({ startsAt: -1 });

    if (!event) {
      throw new NotFoundError('Event not found');
    }

    return this._formatEvent(event);
  }

  async updateEvent(eventId, ownerId, updates) {
    const event = await EventModel.findById(eventId);
    if (!event) {
      throw new NotFoundError('Event not found');
    }

    /* Check ownership */
    if (event.ownerId.toString() !== ownerId.toString()) {
      throw new UnauthorizedError('Unauthorized');
    }

    /* Allow updating: name, description, settings */
    if (updates.name) event.name = updates.name;
    if (updates.description) event.description = updates.description;
    if (updates.settings)
      event.settings = { ...event.settings, ...updates.settings };

    await event.save();
    logger.info(`Event updated: ${eventId}`);

    return this._formatEvent(event);
  }

  async startEvent(eventId, userId) {
    const event = await EventModel.findById(eventId);
    if (!event) throw new NotFoundError('Event not found');
    if (event.ownerId.toString() !== userId.toString())
      throw new UnauthorizedError('Unauthorized');

    event.state = 'LIVE';
    await event.save();

    logger.info(`Event started: ${eventId}`, {
      eventId,
      userId,
      action: 'EVENT_START',
    });
    return this._formatEvent(event);
  }

  async endEvent(eventId, userId) {
    const event = await EventModel.findById(eventId);
    if (!event) throw new NotFoundError('Event not found');
    if (event.ownerId.toString() !== userId.toString())
      throw new UnauthorizedError('Unauthorized');

    event.state = 'ENDED';
    event.endedAt = new Date();
    await event.save();

    logger.info(`Event ended: ${eventId}`, {
      eventId,
      userId,
      action: 'EVENT_END',
    });
    return this._formatEvent(event);
  }

  async cancelEvent(eventId, userId, reason) {
    const event = await EventModel.findById(eventId);
    if (!event) throw new NotFoundError('Event not found');
    if (event.ownerId.toString() !== userId.toString())
      throw new UnauthorizedError('Unauthorized');

    event.state = 'CANCELLED';
    event.cancelledAt = new Date();
    event.cancelledReason = reason;
    await event.save();

    logger.info(`Event cancelled: ${eventId}`, {
      eventId,
      userId,
      action: 'EVENT_CANCEL',
      reason,
    });
    return this._formatEvent(event);
  }

  async getEventParticipants(eventId) {
    const participants = await ParticipantModel.find(
      await this._activeParticipantQuery(eventId),
    );
    return participants;
  }

  async getEventParticipantCount(eventId) {
    return await ParticipantModel.countDocuments(
      await this._activeParticipantQuery(eventId),
    );
  }

  async regenerateAccessCode(eventId, userId) {
    const event = await EventModel.findById(eventId);
    if (!event) {
      throw new NotFoundError('Event not found');
    }

    /* Check ownership */
    if (event.ownerId.toString() !== userId.toString()) {
      throw new UnauthorizedError('Unauthorized');
    }

    /* Generate new access code */
    const newAccessCode = generateEventCode(6);
    event.accessCode = newAccessCode;
    await event.save();

    logger.info(`Access code regenerated for event ${eventId}`);
    return this._formatEvent(event);
  }

  async getPhoneMicrophoneLink(eventId, userId, userRole, frontendUrl) {
    const event = await EventModel.findById(eventId);
    if (!event) {
      throw new NotFoundError('Event not found');
    }

    await eventPermissionsService.assertPhoneMicrophone(event._id, {
      userId,
      role: userRole,
    });

    const token = generateToken(
      {
        userId: event.ownerId.toString(),
        email: `phone-microphone:${event._id}`,
        role: 'DJ',
        type: 'phone-microphone',
        eventId: event._id.toString(),
      },
      '15m',
    );
    const baseUrl = (frontendUrl || '').replace(/\/$/, '');
    return `${baseUrl}/dj/microphone/${event._id}?token=${encodeURIComponent(token)}`;
  }

  async connectPhoneMicrophone(eventId, deviceName = 'Phone microphone', token) {
    const event = await EventModel.findById(eventId);
    if (!event) {
      throw new NotFoundError('Event not found');
    }

    if (!token) {
      throw new UnauthorizedError('Phone microphone token is required');
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      throw new UnauthorizedError('Invalid phone microphone token');
    }

    if (
      decoded.type !== 'phone-microphone' ||
      decoded.eventId !== event._id.toString() ||
      decoded.userId !== event.ownerId.toString()
    ) {
      throw new UnauthorizedError('Invalid phone microphone token');
    }

    const microphone = {
      eventId: event._id.toString(),
      deviceName,
      connectedAt: new Date().toISOString(),
    };

    logger.info(`Phone microphone connected for event ${eventId}`);
    return microphone;
  }

  async addEventMember(eventId, userId, role, actorUserId) {
    /* Check if already a member */
    const existing = await EventMemberModel.findOne({ eventId, userId });
    if (existing) {
      throw new ValidationError('User is already an event member');
    }

    const member = new EventMemberModel({
      eventId,
      userId,
      role,
      permissions: defaultPermissionsForRole(role),
      addedBy: actorUserId,
    });

    await member.save();
    logger.info(`User ${userId} added to event ${eventId} as ${role}`);
    return member;
  }

  _formatEvent(event) {
    return {
      id: event._id,
      name: event.name,
      description: event.description,
      ownerId: typeof event.ownerId === 'object' ? event.ownerId : { _id: event.ownerId },
      eventId: event.eventId,
      accessCode: event.accessCode,
      qrCodeUrl: event.qrCodeUrl,
      state: event.state,
      startsAt: event.startsAt,
      endedAt: event.endedAt,
      currentSongId: event.currentSongId,
      settings: event.settings,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }

  async _activeParticipantQuery(eventId) {
    const event = await EventModel.findById(eventId).select('ownerId').lean();
    const query = { eventId, leftAt: null };
    if (event?.ownerId) query.userId = { $ne: event.ownerId };
    return query;
  }
}

module.exports = new EventsService();
