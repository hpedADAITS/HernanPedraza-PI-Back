const bcrypt = require('bcryptjs');
const { ParticipantModel, EventMemberModel } = require('../models/schema');
const { logger } = require('../utils');
const { ValidationError, NotFoundError, ForbiddenError } = require('../errors');
const cooldownCache = require('../utils/cooldown-cache');

class ParticipantsService {
  async joinEvent(
    eventId,
    nickname,
    profilePicture = null,
    password,
    userId,
    options = {},
  ) {
    const nicknameLower = nickname.toLowerCase().trim();
    const existing = await ParticipantModel.findOne({
      eventId,
      nicknameLower,
    }).select('+passwordHash');

    if (existing) {
      if (existing.passwordHash) {
        if (!password) {
          throw new ValidationError('This nickname is protected. Enter its password to join.');
        }

        const passwordMatches = await bcrypt.compare(password, existing.passwordHash);
        if (!passwordMatches) {
          throw new ValidationError('Incorrect password for this nickname.');
        }

        existing.leftAt = null;
        existing.kickedAt = undefined;
        existing.userId = userId;
        existing.profilePicture = profilePicture ?? existing.profilePicture;
        existing.joinedAt = new Date();
        existing.lastSeenAt = new Date();
        await existing.save();

        logger.info(`Protected participant resumed event: ${eventId} - ${nickname}`);
        return this._formatParticipant(existing);
      }

      if (!existing.leftAt && typeof options.onDuplicateActive === 'function') {
        options.onDuplicateActive(this._formatParticipant(existing));
      }

      if (!existing.leftAt) {
        throw new ValidationError('Nickname already taken in this event');
      }

      existing.leftAt = null;
      existing.kickedAt = undefined;
      existing.kickedBy = undefined;
      existing.kickReason = undefined;
      existing.userId = userId;
      existing.profilePicture = profilePicture ?? existing.profilePicture;
      existing.joinedAt = new Date();
      existing.lastSeenAt = new Date();
      await existing.save();

      logger.info(`Participant rejoined event: ${eventId} - ${nickname}`);
      return this._formatParticipant(existing);
    }

    const participant = new ParticipantModel({
      eventId,
      nickname,
      nicknameLower,
      profilePicture,
      userId,
      joinedAt: new Date(),
      lastSeenAt: new Date(),
    });

    await participant.save();
    logger.info(`Participant joined event: ${eventId} - ${nickname}`);

    return this._formatParticipant(participant);
  }

  async setParticipantPassword(participantId, password, user) {
    const participant = await ParticipantModel.findById(participantId).select('+passwordHash');
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    const userId = user?.userId?.toString();
    const isPrivileged = user?.role === 'DJ' || user?.role === 'ADMIN';
    if (participant.userId && participant.userId.toString() !== userId && !isPrivileged) {
      throw new ForbiddenError('You can only protect your own attendee name');
    }

    participant.userId = participant.userId || userId;
    participant.passwordHash = await bcrypt.hash(password, 10);
    participant.passwordSetAt = new Date();
    await participant.save();

    logger.info(`Participant password set: ${participantId}`);
    return this._formatParticipant(participant);
  }

  async leaveEvent(participantId) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    participant.leftAt = new Date();
    await participant.save();
    logger.info(`Participant left event: ${participant.eventId}`);

    return this._formatParticipant(participant);
  }

  async getParticipant(participantId) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }
    return this._formatParticipant(participant);
  }

  async getEventParticipants(eventId) {
    const participants = await ParticipantModel.find({
      eventId,
      leftAt: null,
    }).sort({ joinedAt: 1 });

    return participants.map((p) => this._formatParticipant(p));
  }

  async countActiveParticipants(eventId) {
    return await ParticipantModel.countDocuments({
      eventId,
      leftAt: null,
    });
  }

  async updateLastSeen(participantId) {
    const participant = await ParticipantModel.findByIdAndUpdate(
      participantId,
      { lastSeenAt: new Date() },
      { new: true },
    );
    return participant;
  }

  async setParticipantCooldown(participantId, durationMs, reason, actorUser) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    const userIdStr = await this._assertParticipantAdminPermission(
      participant,
      actorUser,
    );

    /* Set cooldown in memory cache instead of DB */
    cooldownCache.setCooldown(
      participant.eventId.toString(),
      participantId.toString(),
      durationMs,
      reason
    );

    logger.info(
      `Participant ${participantId} on cooldown for ${durationMs}ms`,
      {
        eventId: participant.eventId,
        userId: userIdStr,
        participantId,
        action: 'PARTICIPANT_COOLDOWN',
        reason,
        durationMs,
      }
    );

    /* Return both formatted participant and event info for socket broadcast */
    return {
      participant: this._formatParticipant(participant),
      eventId: participant.eventId,
      action: 'participant_cooldown',
    };
  }

  async kickParticipant(participantId, reason, actorUser) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    const userIdStr = await this._assertParticipantAdminPermission(
      participant,
      actorUser,
    );

    participant.kickedAt = new Date();
    participant.kickedBy = userIdStr;
    participant.kickReason = reason;
    participant.leftAt = new Date();
    await participant.save();

    logger.info(`Participant ${participantId} kicked: ${reason}`, {
      eventId: participant.eventId,
      userId: userIdStr,
      participantId,
      action: 'PARTICIPANT_KICK',
      reason,
    });

    /* Return both formatted participant and event info for socket broadcast */
    return {
      participant: this._formatParticipant(participant),
      eventId: participant.eventId,
      action: 'participant_kicked',
    };
  }

  async ensureParticipantCanInteract(
    participantId,
    eventId,
    { checkCooldown = false } = {},
  ) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    if (
      eventId &&
      participant.eventId.toString() !== eventId.toString()
    ) {
      throw new ValidationError('Participant is not part of this event');
    }

    if (participant.isBanned) {
      throw new ForbiddenError('Participant has been banned from this event');
    }

    if (participant.leftAt) {
      if (participant.kickedAt) {
        throw new ForbiddenError('Participant was kicked from this event');
      }
      throw new ForbiddenError('Participant is no longer active in this event');
    }

    if (
      checkCooldown &&
      cooldownCache.isOnCooldown(
        participant.eventId.toString(),
        participant._id.toString(),
      )
    ) {
      const cooldown = cooldownCache.getCooldown(
        participant.eventId.toString(),
        participant._id.toString(),
      );
      throw new ValidationError(
        `Participant is on cooldown. Reason: ${cooldown.reason}`,
      );
    }

    return participant;
  }

  async banParticipant(participantId, reason, actorUserId) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    participant.bannedAt = new Date();
    participant.bannedBy = actorUserId;
    participant.banReason = reason;
    participant.isBanned = true;
    participant.leftAt = new Date();
    await participant.save();

    logger.info(`Participant ${participantId} banned: ${reason}`, {
      eventId: participant.eventId,
      userId: actorUserId,
      participantId,
      action: 'PARTICIPANT_BAN',
      reason,
    });
    return this._formatParticipant(participant);
  }

  async setPremium(participantId, isPremium) {
    const participant = await ParticipantModel.findByIdAndUpdate(
      participantId,
      { isPremium },
      { new: true },
    );
    return this._formatParticipant(participant);
  }

  _formatParticipant(participant) {
    /* Check in-memory cooldown cache */
    const cooldown = cooldownCache.getCooldown(
      participant.eventId.toString(),
      participant._id.toString()
    );

    return {
      _id: participant._id.toString(),
      eventId: participant.eventId,
      nickname: participant.nickname,
      profilePicture: participant.profilePicture,
      socketId: participant.socketId,
      joinedAt: participant.joinedAt,
      lastSeenAt: participant.lastSeenAt,
      isBanned: participant.isBanned,
      cooldownUntil: cooldown ? new Date(cooldown.expiresAt) : null,
      isPremium: participant.isPremium,
      passwordProtected: Boolean(participant.passwordHash || participant.passwordSetAt),
      leftAt: participant.leftAt,
    };
  }

  _normalizeActorUser(actorUser) {
    if (typeof actorUser === 'string') {
      return { userId: actorUser, role: null };
    }

    if (actorUser && typeof actorUser === 'object') {
      return {
        userId: actorUser.userId?.toString() || actorUser._id?.toString() || null,
        role: actorUser.role || null,
      };
    }

    return { userId: null, role: null };
  }

  async _assertParticipantAdminPermission(participant, actorUser) {
    const { userId, role } = this._normalizeActorUser(actorUser);

    if (!userId) {
      logger.error('Invalid actor user:', actorUser);
      throw new ValidationError('Invalid actor user ID');
    }

    if (role === 'ADMIN') {
      return userId;
    }

    const membership = await EventMemberModel.findOne({
      eventId: participant.eventId,
      userId,
    })
      .select({ permissions: 1 })
      .lean();

    const canKickParticipant =
      Array.isArray(membership?.permissions) &&
      membership.permissions.includes('PARTICIPANT_KICK');

    if (!canKickParticipant) {
      throw new ForbiddenError(
        'You do not have permission to manage attendees in this event',
      );
    }

    return userId;
  }
}

module.exports = new ParticipantsService();
