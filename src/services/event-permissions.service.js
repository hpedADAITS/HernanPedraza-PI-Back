const { EventModel, EventMemberModel } = require('../models/schema');
const { ForbiddenError, NotFoundError, UnauthorizedError } = require('../errors');
const { logger } = require('../utils');

const PARTICIPANT_MANAGE_PERMISSIONS = ['PARTICIPANT_KICK', 'PARTICIPANT_BAN'];
const PHONE_MICROPHONE_PERMISSIONS = [
  'EVENT_SETTINGS_EDIT',
  'QUEUE_EDIT',
  'SONG_APPROVE_REJECT',
];

const VALID_ROLES = new Set(['DJ', 'ATTENDEE']);

function actorId(actor) {
  if (typeof actor === 'string') return actor;
  return actor?.userId?.toString() || actor?._id?.toString() || actor?.id?.toString() || null;
}

function objectId(value) {
  return value?._id ?? value;
}

function normalizeRole(role) {
  if (typeof role === 'string' && VALID_ROLES.has(role)) {
    return role;
  }
  return null;
}

function assertActorRole(actor) {
  const role = normalizeRole(actor?.role);
  if (role === null) {
    const userId = actorId(actor);
    logger.error('CRITICAL: Actor has no valid role. Actor must have role: \'DJ\' or \'ATTENDEE\'. Got:', {
      role: actor?.role,
      userId,
      actorKeys: actor ? Object.keys(actor) : null,
    });
    throw new UnauthorizedError('Actor has no valid role. Authentication may be incomplete.');
  }
  return role;
}

class EventPermissionsService {
  async getEvent(eventId) {
    const event = await EventModel.findById(eventId).select('ownerId').lean();
    if (!event) throw new NotFoundError('Event not found');
    return event;
  }

  async getContext(eventOrId, actor) {
    const event = typeof eventOrId === 'object' && eventOrId?.ownerId
      ? eventOrId
      : await this.getEvent(eventOrId);
    const userId = actorId(actor);

    logger.info('getContext', {
      actorRole: actor?.role,
      actorUserId: userId,
      actorKeys: actor ? Object.keys(actor) : null,
    });

    if (!userId) return { event, userId: null, role: null, isOwner: false, isDj: false, member: null };

    const role = normalizeRole(actor?.role);
    const isDj = role === 'DJ';
    const isOwner = objectId(event.ownerId)?.toString() === userId.toString();

    if (role === null) {
      logger.warn('getContext: actor has no valid role — treating as unauthenticated. This may indicate a bug upstream.', {
        userId,
        actorRole: actor?.role,
      });
      return { event, userId, role: null, isOwner: false, isDj: false, member: null };
    }

    /* DJs have full event permissions. Event-scoped permission membership
       only matters for non-DJ users. */
    let member = null;
    if (!isOwner && !isDj) {
      const memberQuery = EventMemberModel.findOne({ eventId: event._id, userId });
      member = typeof memberQuery?.select === 'function'
        ? await memberQuery.select('role permissions').lean()
        : null;
    }

    return { event, userId, role, isOwner, isDj, member };
  }

  hasAnyPermission(context, permissions) {
    if (context.isDj || context.isOwner) return true;
    return Array.isArray(context.member?.permissions) && permissions.some((permission) => (
      context.member.permissions.includes(permission)
    ));
  }

  isEventDj(context) {
    const result = context.isDj
      || context.isOwner
      || context.member?.role === 'DJ'
      || (!context.member && context.role === 'DJ');
    logger.info('isEventDj', { isDj: context.isDj, isOwner: context.isOwner, memberRole: context.member?.role, result });
    return result;
  }

  async assertEventDj(eventId, actor, message = 'You do not have permission to manage this event') {
    assertActorRole(actor);
    const context = await this.getContext(eventId, actor);
    if (this.isEventDj(context)) return context;
    throw new ForbiddenError(message);
  }

  async assertAnyPermission(eventId, actor, permissions, message = 'You do not have permission to perform this action') {
    assertActorRole(actor);
    const context = await this.getContext(eventId, actor);
    logger.info('assertAnyPermission context', {
      isDj: context.isDj,
      isOwner: context.isOwner,
      memberRole: context.member?.role,
      memberPermissions: context.member?.permissions,
    });
    if (this.isEventDj(context) || this.hasAnyPermission(context, permissions)) return context;
    throw new ForbiddenError(message);
  }

  async assertOwner(eventId, actor, message = 'Unauthorized') {
    assertActorRole(actor);
    const context = await this.getContext(eventId, actor);
    if (context.isDj || context.isOwner) return context;
    throw new UnauthorizedError(message);
  }

  async assertSongAdmin(eventId, actor) {
    return this.assertAnyPermission(
      eventId,
      actor,
      ['SONG_APPROVE_REJECT'],
      'You do not have permission to manage songs in this event',
    );
  }

  async assertParticipantAdmin(eventId, actor) {
    return this.assertAnyPermission(
      eventId,
      actor,
      PARTICIPANT_MANAGE_PERMISSIONS,
      'You do not have permission to manage attendees in this event',
    );
  }

  async assertPhoneMicrophone(eventId, actor) {
    return this.assertAnyPermission(eventId, actor, PHONE_MICROPHONE_PERMISSIONS, 'Unauthorized');
  }
}

module.exports = new EventPermissionsService();
