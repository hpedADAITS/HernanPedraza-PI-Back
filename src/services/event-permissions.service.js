const { EventModel, EventMemberModel } = require('../models/schema');
const { ForbiddenError, NotFoundError, UnauthorizedError } = require('../errors');
const { logger } = require('../utils');

const PARTICIPANT_MANAGE_PERMISSIONS = ['PARTICIPANT_KICK', 'PARTICIPANT_BAN'];
const PHONE_MICROPHONE_PERMISSIONS = [
  'EVENT_SETTINGS_EDIT',
  'QUEUE_EDIT',
  'SONG_APPROVE_REJECT',
];

function actorId(actor) {
  if (typeof actor === 'string') return actor;
  return actor?.userId?.toString() || actor?._id?.toString() || actor?.id?.toString() || null;
}

function objectId(value) {
  return value?._id ?? value;
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

    if (!userId) return { event, userId: null, role: null, isOwner: false, isAdmin: false, member: null };

    const isAdmin = actor?.role === 'ADMIN' || actor?.role === 'DJ';
    const isOwner = objectId(event.ownerId)?.toString() === userId.toString();

    // Admins and owners skip member lookup - they have full permissions
    const member = isOwner || isAdmin
      ? null
      : await EventMemberModel.findOne({ eventId: event._id, userId })
        .select('role permissions')
        .lean();

    return { event, userId, role: actor?.role || null, isOwner, isAdmin, member };
  }

  hasAnyPermission(context, permissions) {
    if (context.isAdmin || context.isOwner) return true;
    return Array.isArray(context.member?.permissions) && permissions.some((permission) => (
      context.member.permissions.includes(permission)
    ));
  }

  isEventDj(context) {
    const result = context.isAdmin || context.isOwner || context.member?.role === 'DJ';
    logger.info('isEventDj', { isAdmin: context.isAdmin, isOwner: context.isOwner, memberRole: context.member?.role, result });
    return result;
  }

  async assertEventDj(eventId, actor, message = 'You do not have permission to manage this event') {
    const context = await this.getContext(eventId, actor);
    if (this.isEventDj(context)) return context;
    throw new ForbiddenError(message);
  }

  async assertAnyPermission(eventId, actor, permissions, message = 'You do not have permission to perform this action') {
    const context = await this.getContext(eventId, actor);
    logger.info('assertAnyPermission context', {
      isAdmin: context.isAdmin,
      isOwner: context.isOwner,
      memberRole: context.member?.role,
      memberPermissions: context.member?.permissions,
    });
    if (this.isEventDj(context) || this.hasAnyPermission(context, permissions)) return context;
    throw new ForbiddenError(message);
  }

  async assertOwner(eventId, actor, message = 'Unauthorized') {
    const context = await this.getContext(eventId, actor);
    if (context.isAdmin || context.isOwner) return context;
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
