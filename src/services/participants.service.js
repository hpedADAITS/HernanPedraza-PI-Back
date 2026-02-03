const { ParticipantModel, EventActionLogModel } = require("../mongo_schema");
const { logger } = require("../utils");

class ParticipantsService {
  async joinEvent(eventId, nickname) {
    // Check if participant already exists
    const existing = await ParticipantModel.findOne({
      eventId,
      nicknameLower: nickname.toLowerCase().trim(),
      leftAt: null,
    });

    if (existing) {
      throw new Error("Nickname already taken in this event");
    }

    const participant = new ParticipantModel({
      eventId,
      nickname,
      nicknameLower: nickname.toLowerCase().trim(),
      joinedAt: new Date(),
      lastSeenAt: new Date(),
    });

    await participant.save();
    logger.info(`Participant joined event: ${eventId} - ${nickname}`);

    return this._formatParticipant(participant);
  }

  async leaveEvent(participantId) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new Error("Participant not found");
    }

    participant.leftAt = new Date();
    await participant.save();
    logger.info(`Participant left event: ${participant.eventId}`);

    return this._formatParticipant(participant);
  }

  async getParticipant(participantId) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new Error("Participant not found");
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
      { new: true }
    );
    return participant;
  }

  async setParticipantCooldown(participantId, durationMs, reason, actorUserId) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new Error("Participant not found");
    }

    const cooldownUntil = new Date(Date.now() + durationMs);
    participant.cooldownUntil = cooldownUntil;
    participant.cooldownReason = reason;
    await participant.save();

    await EventActionLogModel.create({
      eventId: participant.eventId,
      actorUserId,
      type: "PARTICIPANT_COOLDOWN",
      participantId,
      meta: { reason, durationMs },
    });

    logger.info(`Participant ${participantId} on cooldown until ${cooldownUntil}`);
    return this._formatParticipant(participant);
  }

  async kickParticipant(participantId, reason, actorUserId) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new Error("Participant not found");
    }

    participant.kickedAt = new Date();
    participant.kickedBy = actorUserId;
    participant.kickReason = reason;
    participant.leftAt = new Date();
    await participant.save();

    await EventActionLogModel.create({
      eventId: participant.eventId,
      actorUserId,
      type: "PARTICIPANT_KICK",
      participantId,
      meta: { reason },
    });

    logger.info(`Participant ${participantId} kicked: ${reason}`);
    return this._formatParticipant(participant);
  }

  async banParticipant(participantId, reason, actorUserId) {
    const participant = await ParticipantModel.findById(participantId);
    if (!participant) {
      throw new Error("Participant not found");
    }

    participant.bannedAt = new Date();
    participant.bannedBy = actorUserId;
    participant.banReason = reason;
    participant.isBanned = true;
    participant.leftAt = new Date();
    await participant.save();

    await EventActionLogModel.create({
      eventId: participant.eventId,
      actorUserId,
      type: "PARTICIPANT_BAN",
      participantId,
      meta: { reason },
    });

    logger.info(`Participant ${participantId} banned: ${reason}`);
    return this._formatParticipant(participant);
  }

  async setPremium(participantId, isPremium) {
    const participant = await ParticipantModel.findByIdAndUpdate(
      participantId,
      { isPremium },
      { new: true }
    );
    return this._formatParticipant(participant);
  }

  _formatParticipant(participant) {
    return {
      id: participant._id,
      eventId: participant.eventId,
      nickname: participant.nickname,
      socketId: participant.socketId,
      joinedAt: participant.joinedAt,
      lastSeenAt: participant.lastSeenAt,
      isBanned: participant.isBanned,
      cooldownUntil: participant.cooldownUntil,
      isPremium: participant.isPremium,
      leftAt: participant.leftAt,
    };
  }
}

module.exports = new ParticipantsService();
