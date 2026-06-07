const {
  UserModel,
  EventModel,
  FriendRequestModel,
  FriendshipModel,
  EventInviteModel,
} = require('../models/schema');
const { logger } = require('../utils');
const { ValidationError, NotFoundError, ForbiddenError } = require('../errors');
const emailService = require('./email.service');

const ANONYMOUS_EMAIL_DOMAIN = '@Syncrequest.local';

function isAnonymousUser(user) {
  return typeof user?.email === 'string' && user.email.endsWith(ANONYMOUS_EMAIL_DOMAIN);
}

class FriendsService {
  /* A user can be friended only if they have a real email and the
     `allowFriendRequests` flag in the most recent participant row
     (per-event snapshot) is not false. We treat missing data as opt-in. */
  async _canReceiveFriendRequests(userId) {
    const { ParticipantModel } = require('../models/schema');
    const last = await ParticipantModel.findOne({ userId })
      .sort({ updatedAt: -1 })
      .select('socialPrefs')
      .lean();
    if (!last) return true;
    return last.socialPrefs?.allowFriendRequests !== false;
  }

  async sendFriendRequest(fromUserId, toUserId, message = null) {
    if (!fromUserId || !toUserId) {
      throw new ValidationError('Friend request requires both users');
    }
    if (fromUserId.toString() === toUserId.toString()) {
      throw new ValidationError('You cannot send a friend request to yourself');
    }

    const toUser = await UserModel.findById(toUserId).select('_id email displayName role isActive').lean();
    if (!toUser || !toUser.isActive) {
      throw new NotFoundError('User not found');
    }
    if (isAnonymousUser(toUser)) {
      throw new ValidationError('This attendee has no account and cannot receive friend requests');
    }

    if (!(await this._canReceiveFriendRequests(toUserId))) {
      throw new ForbiddenError('This user is not accepting friend requests right now');
    }

    const existingFriendship = await FriendshipModel.findOne({
      userId: fromUserId,
      friendId: toUserId,
    }).lean();
    if (existingFriendship) {
      throw new ValidationError('You are already friends with this user');
    }

    /* If the reverse direction was pending, treat this as an accept by the
       current user. This makes the handshake symmetric and avoids a
       duplicate pending record. */
    const reversePending = await FriendRequestModel.findOne({
      fromUserId: toUserId,
      toUserId: fromUserId,
      status: 'pending',
    });
    if (reversePending) {
      return this._acceptRequest(reversePending, fromUserId);
    }

    const existing = await FriendRequestModel.findOne({
      fromUserId,
      toUserId,
      status: 'pending',
    });
    if (existing) {
      throw new ValidationError('A pending friend request already exists');
    }

    const request = await FriendRequestModel.create({
      fromUserId,
      toUserId,
      status: 'pending',
      message,
    });

    /* Enrich with the recipient's display info so the caller can show the
       request without an extra round trip. */
    const enriched = await this._enrichRequests([request], fromUserId);
    return { request: enriched[0] || this._formatRequest(request, fromUserId) };
  }

  async cancelFriendRequest(requestId, fromUserId) {
    const request = await FriendRequestModel.findById(requestId);
    if (!request) throw new NotFoundError('Friend request not found');
    if (request.fromUserId.toString() !== fromUserId.toString()) {
      throw new ForbiddenError('Only the requester can cancel');
    }
    if (request.status !== 'pending') {
      throw new ValidationError('This request can no longer be cancelled');
    }
    request.status = 'cancelled';
    request.respondedAt = new Date();
    await request.save();
    return { request: this._formatRequest(request, fromUserId) };
  }

  async respondFriendRequest(requestId, userId, accept) {
    const request = await FriendRequestModel.findById(requestId);
    if (!request) throw new NotFoundError('Friend request not found');
    if (request.toUserId.toString() !== userId.toString()) {
      throw new ForbiddenError('Only the recipient can respond');
    }
    if (request.status !== 'pending') {
      throw new ValidationError('This request has already been responded to');
    }
    if (accept) {
      return this._acceptRequest(request, userId);
    }
    request.status = 'denied';
    request.respondedAt = new Date();
    await request.save();
    return { request: this._formatRequest(request, userId) };
  }

  async _acceptRequest(request, viewerUserId) {
    request.status = 'accepted';
    request.respondedAt = new Date();
    await request.save();

    /* Symmetric storage so each side can list their friends with one
       indexed query. */
    await Promise.all([
      FriendshipModel.updateOne(
        { userId: request.fromUserId, friendId: request.toUserId },
        { $setOnInsert: { userId: request.fromUserId, friendId: request.toUserId, fromRequestId: request._id, since: new Date() } },
        { upsert: true },
      ),
      FriendshipModel.updateOne(
        { userId: request.toUserId, friendId: request.fromUserId },
        { $setOnInsert: { userId: request.toUserId, friendId: request.fromUserId, fromRequestId: request._id, since: new Date() } },
        { upsert: true },
      ),
    ]);

    return { request: this._formatRequest(request, viewerUserId) };
  }

  async unfriend(userId, friendId) {
    const result = await FriendshipModel.deleteMany({
      $or: [
        { userId, friendId },
        { userId: friendId, friendId: userId },
      ],
    });
    if (result.deletedCount === 0) {
      throw new NotFoundError('Friendship not found');
    }
    return { success: true };
  }

  async listFriends(userId) {
    const rows = await FriendshipModel.find({ userId })
      .sort({ since: -1 })
      .lean();
    if (rows.length === 0) return [];
    const friendIds = rows.map((row) => row.friendId);
    const users = await UserModel.find({ _id: { $in: friendIds } })
      .select('_id displayName profilePicture role emailRegistered')
      .lean();
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    return rows
      .map((row) => this._formatFriendship(row, byId.get(row.friendId.toString())))
      .filter(Boolean);
  }

  async listIncomingRequests(userId) {
    const rows = await FriendRequestModel.find({ toUserId: userId, status: 'pending' })
      .sort({ createdAt: -1 })
      .lean();
    return this._enrichRequests(rows, userId);
  }

  async listOutgoingRequests(userId) {
    const rows = await FriendRequestModel.find({ fromUserId: userId, status: 'pending' })
      .sort({ createdAt: -1 })
      .lean();
    return this._enrichRequests(rows, userId);
  }

  async _enrichRequests(rows, viewerUserId) {
    if (rows.length === 0) return [];
    const otherIds = rows.map((row) =>
      row.fromUserId.toString() === viewerUserId.toString() ? row.toUserId : row.fromUserId,
    );
    const users = await UserModel.find({ _id: { $in: otherIds } })
      .select('_id displayName profilePicture role emailRegistered')
      .lean();
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    return rows.map((row) => this._formatRequest(row, viewerUserId, byId)).filter(Boolean);
  }

  async sendEventInvite(fromUserId, { friendId, eventCode, eventId, eventName, message }) {
    const fromUser = await UserModel.findById(fromUserId).select('_id displayName role isActive').lean();
    if (!fromUser || !fromUser.isActive) {
      throw new NotFoundError('User not found');
    }

    const isFriend = await FriendshipModel.findOne({ userId: fromUserId, friendId }).lean();
    if (!isFriend) {
      throw new ForbiddenError('You can only invite people you are friends with');
    }

    const toUser = await UserModel.findById(friendId).select('_id email displayName role isActive').lean();
    if (!toUser || !toUser.isActive) {
      throw new NotFoundError('Friend not found');
    }
    if (!toUser.email) {
      throw new ValidationError('Friend has no email address on file');
    }

    let resolvedEvent = null;
    if (eventId) {
      resolvedEvent = await EventModel.findById(eventId).select('_id name accessCode ownerId').lean();
      if (!resolvedEvent) throw new NotFoundError('Event not found');
    }

    const invite = await EventInviteModel.create({
      fromUserId,
      toUserId: friendId,
      toEmail: toUser.email,
      eventId: resolvedEvent?._id || null,
      eventName: resolvedEvent?.name || eventName || null,
      eventCode: resolvedEvent?.accessCode || eventCode,
      message,
      status: 'sent',
    });

    const sendResult = await emailService.sendEventInviteEmail({
      toEmail: toUser.email,
      inviter: { displayName: fromUser.displayName },
      invitee: { displayName: toUser.displayName },
      eventName: resolvedEvent?.name || eventName,
      eventCode: resolvedEvent?.accessCode || eventCode,
      message,
    });

    if (!sendResult.success) {
      logger.warn('Event invite email send failed', { inviteId: invite._id, error: sendResult.error });
    }

    return { invite: this._formatInvite(invite, fromUserId) };
  }

  async listIncomingInvites(userId) {
    const rows = await EventInviteModel.find({ toUserId: userId })
      .sort({ sentAt: -1 })
      .limit(50)
      .lean();
    return this._enrichInvites(rows, userId);
  }

  async listOutgoingInvites(userId) {
    const rows = await EventInviteModel.find({ fromUserId: userId })
      .sort({ sentAt: -1 })
      .limit(50)
      .lean();
    return this._enrichInvites(rows, userId);
  }

  async respondEventInvite(inviteId, userId, accept) {
    const invite = await EventInviteModel.findById(inviteId);
    if (!invite) throw new NotFoundError('Event invite not found');
    if (invite.toUserId.toString() !== userId.toString()) {
      throw new ForbiddenError('Only the recipient can respond');
    }
    if (!['sent', 'accepted', 'dismissed'].includes(invite.status)) {
      throw new ValidationError('This invite can no longer be changed');
    }
    invite.status = accept ? 'accepted' : 'dismissed';
    invite.respondedAt = new Date();
    await invite.save();
    return { invite: this._formatInvite(invite, userId) };
  }

  async _enrichInvites(rows, viewerUserId) {
    if (rows.length === 0) return [];
    const otherIds = rows.map((row) =>
      row.fromUserId.toString() === viewerUserId.toString() ? row.toUserId : row.fromUserId,
    );
    const users = await UserModel.find({ _id: { $in: otherIds } })
      .select('_id displayName profilePicture role emailRegistered')
      .lean();
    const byId = new Map(users.map((u) => [u._id.toString(), u]));
    return rows.map((row) => this._formatInvite(row, viewerUserId, byId)).filter(Boolean);
  }

  /* ────────────────────────── formatters ────────────────────────── */

  _formatRequest(request, viewerUserId, usersById) {
    const isIncoming = request.toUserId.toString() === viewerUserId.toString();
    const otherId = isIncoming ? request.fromUserId : request.toUserId;
    const other = usersById?.get?.(otherId.toString())
      || usersById?.get?.(otherId);
    return {
      id: request._id.toString(),
      direction: isIncoming ? 'incoming' : 'outgoing',
      status: request.status,
      message: request.message || null,
      createdAt: request.createdAt,
      respondedAt: request.respondedAt || null,
      fromUserId: request.fromUserId.toString(),
      toUserId: request.toUserId.toString(),
      other: other
        ? {
            id: other._id.toString(),
            displayName: other.displayName || 'Unknown user',
            profilePicture: other.profilePicture || null,
            role: other.role,
            emailRegistered: Boolean(other.emailRegistered),
          }
        : null,
    };
  }

  _formatFriendship(row, user) {
    if (!user) return null;
    return {
      friendId: row.friendId.toString(),
      since: row.since,
      displayName: user.displayName || 'Unknown user',
      profilePicture: user.profilePicture || null,
      role: user.role,
      emailRegistered: Boolean(user.emailRegistered),
    };
  }

  _formatInvite(invite, viewerUserId, usersById) {
    const isIncoming = invite.toUserId.toString() === viewerUserId.toString();
    const otherId = isIncoming ? invite.fromUserId : invite.toUserId;
    const other = usersById?.get?.(otherId.toString())
      || usersById?.get?.(otherId);
    return {
      id: invite._id.toString(),
      direction: isIncoming ? 'incoming' : 'outgoing',
      status: invite.status,
      eventId: invite.eventId ? invite.eventId.toString() : null,
      eventName: invite.eventName || null,
      eventCode: invite.eventCode,
      message: invite.message || null,
      sentAt: invite.sentAt,
      respondedAt: invite.respondedAt || null,
      fromUserId: invite.fromUserId.toString(),
      toUserId: invite.toUserId.toString(),
      other: other
        ? {
            id: other._id.toString(),
            displayName: other.displayName || 'Unknown user',
            profilePicture: other.profilePicture || null,
            role: other.role,
            emailRegistered: Boolean(other.emailRegistered),
          }
        : null,
    };
  }
}

module.exports = new FriendsService();
