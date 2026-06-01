const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { ParticipantModel, UserModel } = require('../models/schema');
const { ForbiddenError, ValidationError } = require('../errors');
const { logger } = require('../utils');
const authService = require('./auth.service');
const participantsService = require('./participants.service');

class AttendeeSessionService {
  async joinEvent(eventId, nickname, profilePicture = null, password, options = {}) {
    const session = await mongoose.startSession();
    let result;

    try {
      await session.withTransaction(async () => {
        result = await this._joinEventInSession(
          eventId,
          nickname,
          profilePicture,
          password,
          options,
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    return result;
  }

  async _joinEventInSession(eventId, nickname, profilePicture, password, options, dbSession) {
    const displayName = nickname.trim();
    const existing = await this._getExistingParticipant(eventId, displayName, dbSession);
    await this._assertCanClaimParticipant(existing, password, options);

    const user = await this._resolveUser(existing, displayName, dbSession);
    const participant = await participantsService.joinEvent(
      eventId,
      displayName,
      profilePicture,
      password,
      user._id,
      { ...options, dbSession },
    );

    return {
      token: authService.buildAuthToken(user),
      user: this._formatUser(user),
      participant,
    };
  }

  async _getExistingParticipant(eventId, nickname, dbSession) {
    await participantsService.ensureNicknameIsNotAccessCode(nickname);
    return ParticipantModel.findOne({
      eventId,
      nicknameLower: nickname.toLowerCase(),
    })
      .select('+passwordHash')
      .session(dbSession);
  }

  async _assertCanClaimParticipant(participant, password, options) {
    if (!participant) return;
    if (participant.isBanned) {
      throw new ForbiddenError('Participant has been banned from this event');
    }

    if (participant.passwordHash) {
      if (!password) {
        throw new ValidationError('This nickname is protected. Enter its password to join.');
      }
      if (!(await bcrypt.compare(password, participant.passwordHash))) {
        throw new ValidationError('Incorrect password for this nickname.');
      }
      return;
    }

    if (!participant.leftAt) {
      if (typeof options.onDuplicateActive === 'function') {
        options.onDuplicateActive(participantsService._formatParticipant(participant));
      }
      throw new ValidationError('Nickname already taken in this event');
    }
  }

  async _resolveUser(participant, displayName, dbSession) {
    const existingUser = participant?.passwordHash && participant.userId
      ? await UserModel.findById(participant.userId).session(dbSession)
      : null;
    if (existingUser) return existingUser;

    const [user] = await UserModel.create(
      [
        {
          email: `attendee_${crypto.randomUUID()}@syncrekuest.local`,
          passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
          displayName,
          role: 'ATTENDEE',
        },
      ],
      { session: dbSession },
    );

    logger.info(`Attendee session user created: ${user.email}`);
    return user;
  }

  _formatUser(user) {
    return {
      id: user._id,
      email: user.email,
      displayName: user.displayName,
      profilePicture: user.profilePicture,
      role: user.role,
    };
  }
}

module.exports = new AttendeeSessionService();
