const bcrypt = require('bcryptjs');
const {
  EventModel,
  ParticipantModel,
  UserModel,
} = require('../models/schema');
const { logger } = require('../utils');
const { ValidationError, NotFoundError, ForbiddenError } = require('../errors');

const eventPermissionsService = require('./event-permissions.service');

class ParticipantsService {
  async ensureNicknameIsNotAccessCode(nickname) {
    const trimmed = nickname.trim();
    if (
      /^[A-Za-z0-9]{4,20}$/.test(trimmed) &&
      (await EventModel.exists({ accessCode: trimmed.toUpperCase() }))
    ) {
      throw new ValidationError('Nickname cannot be a valid access code');
    }
  }

  async joinEvent(
    eventId,
    nickname,
    profilePicture = null,
    password,
    userId,
    options = {},
  ) {
    const { dbSession, socialPrefs } = options;
    const nicknameTrimmed = nickname.trim();
    const nicknameLower = nicknameTrimmed.toLowerCase();
    await this.ensureNicknameIsNotAccessCode(nicknameTrimmed);

    const mergedPrefs = this._mergeSocialPrefs(socialPrefs);

    const existing = await ParticipantModel.findOne({
      eventId,
      nicknameLower,
    })
      .select('+passwordHash')
      .session(dbSession || null);

    if (existing) {
      if (existing.isBanned) {
        throw new ForbiddenError('Participant has been banned from this event');
      }

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
        if (mergedPrefs) {
          this._applySocialPrefs(existing, mergedPrefs, profilePicture, nicknameTrimmed);
        }
        await existing.save({ session: dbSession });

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
      if (mergedPrefs) {
        this._applySocialPrefs(existing, mergedPrefs, profilePicture, nicknameTrimmed);
      }
      await existing.save({ session: dbSession });

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
      socialPrefs: mergedPrefs || {
        showDisplayName: true,
        showProfilePicture: true,
        allowFriendRequests: true,
      },
    });
    if (mergedPrefs) {
      await this._applySocialPrefs(participant, mergedPrefs, profilePicture, nicknameTrimmed);
    }

    await participant.save({ session: dbSession });
    logger.info(`Participant joined event: ${eventId} - ${nickname}`);

    return this._formatParticipant(participant);
  }

  async setParticipantPassword(participantId, password, user) {
    const participant = await ParticipantModel.findById(participantId).select('+passwordHash');
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    this._assertParticipantSession(participant, user);

    participant.passwordHash = await bcrypt.hash(password, 10);
    participant.passwordSetAt = new Date();
    await participant.save();

    logger.info(`Participant password set: ${participantId}`);
    return this._formatParticipant(participant);
  }

  async leaveEvent(participantId, actorUser) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    this._assertParticipantSession(participant, actorUser);

    participant.leftAt = new Date();
    await participant.save();
    logger.info(`Participant left event: ${participant.eventId}`);

    return this._formatParticipant(participant);
  }

  async updateProfile(participantId, updates, actorUser) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      /* DJ fallback: DJs have no Participant document, so the front-end
         stores their User id in currentParticipant._id and calls this
         endpoint with it. Allow a profile-picture update to flow through
         to the User record when the caller is the DJ themselves and only
         the picture is being changed (nickname / socialPrefs don't apply
         to DJs on this route). */
      if (
        updates.profilePicture !== undefined &&
        updates.nickname === undefined &&
        !updates.socialPrefs &&
        actorUser?.userId &&
        participantId.toString() === actorUser.userId.toString()
      ) {
        return this._updateDjProfilePicture(
          actorUser.userId,
          updates.profilePicture,
        );
      }
      throw new NotFoundError('Participant not found');
    }

    this._assertParticipantSession(participant, actorUser);

    if (updates.nickname !== undefined && updates.nickname !== participant.nickname) {
      await this.ensureNicknameIsNotAccessCode(updates.nickname);
      const existing = await ParticipantModel.exists({
        eventId: participant.eventId,
        nicknameLower: updates.nickname.toLowerCase(),
        _id: { $ne: participant._id },
      });
      if (existing) {
        throw new ValidationError('Nickname already taken in this event');
      }
      /* The explicit rename is the new "real" nickname — remember it so a
         social-pref flip back to "show name" can restore it. */
      participant.realNickname = updates.nickname;
      participant.nickname = updates.nickname;
      if (!participant.socialPrefs?.showDisplayName) {
        /* Mask is still on: the public nickname should be the masked form. */
        const masked = formatAnonymousName(participant.anonymousNumber);
        if (masked) participant.nickname = masked;
      }
    }

    if (updates.profilePicture !== undefined) {
      participant.realProfilePicture = updates.profilePicture;
      participant.profilePicture = updates.profilePicture;
      if (participant.socialPrefs && participant.socialPrefs.showProfilePicture === false) {
        participant.profilePicture = null;
      }
    }

    if (updates.socialPrefs) {
      const mergedPrefs = {
        showDisplayName:
          updates.socialPrefs.showDisplayName !== undefined
            ? updates.socialPrefs.showDisplayName
            : (participant.socialPrefs?.showDisplayName ?? true),
        showProfilePicture:
          updates.socialPrefs.showProfilePicture !== undefined
            ? updates.socialPrefs.showProfilePicture
            : (participant.socialPrefs?.showProfilePicture ?? true),
        allowFriendRequests:
          updates.socialPrefs.allowFriendRequests !== undefined
            ? updates.socialPrefs.allowFriendRequests
            : (participant.socialPrefs?.allowFriendRequests ?? true),
      };
      await this._applySocialPrefs(participant, mergedPrefs, participant.realProfilePicture, participant.realNickname);
    }

    await participant.save();
    logger.info(`Participant profile updated: ${participantId}`);

    return this._formatParticipant(participant);
  }

  async _updateDjProfilePicture(userId, profilePicture) {
    const user = await UserModel.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    user.profilePicture = profilePicture;
    await user.save();
    logger.info(`DJ profile picture updated: ${userId}`);
    return this._formatDjAsParticipant(user);
  }

  _formatDjAsParticipant(user) {
    /* Shape the DJ response so the front-end can spread it into its
       currentParticipant snapshot without special-casing. eventId is
       null because DJs are not per-event Participants; the
       controller's socket emit guards on eventId and will no-op. */
    return {
      _id: user._id.toString(),
      id: user._id.toString(),
      userId: user._id.toString(),
      nickname: user.displayName,
      profilePicture: user.profilePicture,
      eventId: null,
    };
  }

  async getParticipant(participantId) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }
    return this._formatParticipant(participant);
  }

  /**
   * Get raw participant document (for internal use like premium checks)
   */
  async getParticipantById(participantId) {
    return ParticipantModel.findById(participantId);
  }

  async getEventParticipants(eventId) {
    const participants = await ParticipantModel.find(
      await this._activeParticipantQuery(eventId),
    ).sort({ joinedAt: 1 });

    return participants.map((p) => this._formatParticipant(p));
  }

  async countActiveParticipants(eventId) {
    return await ParticipantModel.countDocuments(
      await this._activeParticipantQuery(eventId),
    );
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

    participant.cooldownUntil = new Date(Date.now() + durationMs);
    participant.cooldownReason = reason;
    await participant.save();

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
    { checkCooldown = false, actorUser = null } = {},
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

    if (actorUser) {
      this._assertParticipantOwner(participant, actorUser);
    }

    if (
      checkCooldown &&
      participant.cooldownUntil &&
      participant.cooldownUntil.getTime() > Date.now()
    ) {
      throw new ValidationError(
        `Participant is on cooldown. Reason: ${participant.cooldownReason || 'Administrative action'}`,
      );
    }

    if (
      participant.cooldownUntil &&
      participant.cooldownUntil.getTime() <= Date.now()
    ) {
      participant.cooldownUntil = undefined;
      participant.cooldownReason = undefined;
      await participant.save();
    }

    return participant;
  }

  async assertParticipantSession(
    participantId,
    eventId,
    actorUser,
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

    this._assertParticipantSession(participant, actorUser);

    if (
      checkCooldown &&
      participant.cooldownUntil &&
      participant.cooldownUntil.getTime() > Date.now()
    ) {
      throw new ValidationError(
        `Participant is on cooldown. Reason: ${participant.cooldownReason || 'Administrative action'}`,
      );
    }

    if (
      participant.cooldownUntil &&
      participant.cooldownUntil.getTime() <= Date.now()
    ) {
      participant.cooldownUntil = undefined;
      participant.cooldownReason = undefined;
      await participant.save();
    }

    return participant;
  }

  async assertParticipantSocketAccess(participantId, eventId, actorUser) {
    const participant = await this.ensureParticipantCanInteract(
      participantId,
      eventId,
      { actorUser },
    );
    return this._formatParticipant(participant);
  }

  async banParticipant(participantId, reason, actorUser) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    const userIdStr = await this._assertParticipantAdminPermission(
      participant,
      actorUser,
    );

    participant.bannedAt = new Date();
    participant.bannedBy = userIdStr;
    participant.banReason = reason;
    participant.isBanned = true;
    participant.leftAt = new Date();
    await participant.save();

    logger.info(`Participant ${participantId} banned: ${reason}`, {
      eventId: participant.eventId,
      userId: userIdStr,
      participantId,
      action: 'PARTICIPANT_BAN',
      reason,
    });

    return {
      participant: this._formatParticipant(participant),
      eventId: participant.eventId,
      action: 'participant_banned',
    };
  }

  async setPremium(participantId, isPremium, actorUser) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new NotFoundError('Participant not found');
    }

    await this._assertParticipantAdminPermission(participant, actorUser);

    participant.isPremium = isPremium;
    await participant.save();
    return this._formatParticipant(participant);
  }

  _formatParticipant(participant) {
    const cooldownActive =
      participant.cooldownUntil &&
      participant.cooldownUntil.getTime() > Date.now();

    return {
      _id: participant._id.toString(),
      userId: participant.userId?.toString(),
      eventId: participant.eventId,
      nickname: participant.nickname,
      profilePicture: participant.profilePicture,
      socketId: participant.socketId,
      joinedAt: participant.joinedAt,
      lastSeenAt: participant.lastSeenAt,
      isBanned: participant.isBanned,
      cooldownUntil: cooldownActive ? participant.cooldownUntil : null,
      cooldownReason: cooldownActive ? participant.cooldownReason : null,
      isPremium: participant.isPremium,
      passwordProtected: Boolean(participant.passwordHash || participant.passwordSetAt),
      leftAt: participant.leftAt,
      anonymousNumber: participant.anonymousNumber || null,
      socialPrefs: participant.socialPrefs || null,
    };
  }

  _normalizeActorUser(actorUser) {
    if (typeof actorUser === 'string') {
      return { userId: actorUser, role: null };
    }

    if (actorUser && typeof actorUser === 'object') {
      return {
        userId:
          actorUser.userId?.toString() ||
          actorUser._id?.toString() ||
          actorUser.id?.toString() ||
          null,
        role: actorUser.role || null,
      };
    }

    return { userId: null, role: null };
  }

  async _activeParticipantQuery(eventId) {
    const event = await EventModel.findById(eventId).select('ownerId').lean();
    const query = { eventId, leftAt: null };
    if (event?.ownerId) query.userId = { $ne: event.ownerId };
    return query;
  }

  _assertParticipantOwner(participant, actorUser) {
    const { userId } = this._normalizeActorUser(actorUser);

    if (!userId) {
      throw new ForbiddenError('Participant ownership could not be verified');
    }

    if (!participant.userId || participant.userId.toString() !== userId) {
      throw new ForbiddenError('You cannot act as this attendee');
    }
  }

  _assertParticipantSession(participant, actorUser) {
    if (participant.isBanned) {
      throw new ForbiddenError('Participant has been banned from this event');
    }

    if (participant.leftAt) {
      if (participant.kickedAt) {
        throw new ForbiddenError('Participant was kicked from this event');
      }
      throw new ForbiddenError('Participant is no longer active in this event');
    }

    if (!participant.userId) {
      throw new ForbiddenError('Participant ownership must be proven before this action');
    }

    this._assertParticipantOwner(participant, actorUser);
  }

  _mergeSocialPrefs(socialPrefs) {
    if (!socialPrefs || typeof socialPrefs !== 'object') return null;
    return {
      showDisplayName:
        typeof socialPrefs.showDisplayName === 'boolean'
          ? socialPrefs.showDisplayName
          : true,
      showProfilePicture:
        typeof socialPrefs.showProfilePicture === 'boolean'
          ? socialPrefs.showProfilePicture
          : true,
      allowFriendRequests:
        typeof socialPrefs.allowFriendRequests === 'boolean'
          ? socialPrefs.allowFriendRequests
          : true,
    };
  }

  /* Persist the social-pref state and rewrite the public nickname and
     profile picture so the rest of the system (and other clients) see the
     masked form. `realNickname` / `realProfilePicture` keep the originals
     so the toggle is reversible. The "anonymous number" is the count of
     active participants in the event at the time the mask was applied, +1
     for a stable display position. */
  async _applySocialPrefs(participant, prefs, currentProfilePicture, currentNickname) {
    participant.socialPrefs = prefs;
    if (currentNickname) {
      participant.realNickname = currentNickname;
    }
    if (currentProfilePicture !== undefined) {
      participant.realProfilePicture = currentProfilePicture;
    }
    if (prefs.showDisplayName) {
      participant.nickname = participant.realNickname || participant.nickname;
    } else {
      if (!participant.anonymousNumber) {
        participant.anonymousNumber = await this._nextAnonymousNumber(participant.eventId);
      }
      participant.nickname = formatAnonymousName(participant.anonymousNumber);
    }
    if (prefs.showProfilePicture) {
      participant.profilePicture = participant.realProfilePicture ?? participant.profilePicture;
    } else {
      participant.profilePicture = null;
    }
  }

  async _nextAnonymousNumber(eventId) {
    const taken = await ParticipantModel.countDocuments(
      await this._activeParticipantQuery(eventId),
    );
    return taken + 1;
  }

  async _assertParticipantAdminPermission(participant, actorUser) {
    const { userId, role } = this._normalizeActorUser(actorUser);

    if (!userId) {
      logger.error('Invalid actor user:', actorUser);
      throw new ValidationError('Invalid actor user ID');
    }

    if (participant.userId?.toString() === userId) {
      throw new ForbiddenError('You cannot moderate your own attendee session');
    }

    await eventPermissionsService.assertParticipantAdmin(participant.eventId, { userId, role });
    return userId;
  }
}

const ANONYMOUS_LABEL = 'Participant';

function formatAnonymousName(number) {
  if (!Number.isFinite(number) || number < 1) return null;
  return `${ANONYMOUS_LABEL} ${number}`;
}

module.exports = new ParticipantsService();
module.exports.ANONYMOUS_LABEL = ANONYMOUS_LABEL;
module.exports.formatAnonymousName = formatAnonymousName;
