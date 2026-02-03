const { EventModel, EventMemberModel, ParticipantModel, SongModel, defaultPermissionsForRole, EventActionLogModel } = require("../mongo_schema");
const { generateAccessCode } = require("../utils/code-generator");
const { logger } = require("../utils");

class EventsService {
  async createEvent(ownerId, name, description, startsAt) {
    const accessCode = generateAccessCode();

    const event = new EventModel({
      name,
      description,
      ownerId,
      accessCode,
      startsAt: new Date(startsAt),
      state: "DRAFT",
      settings: {
        allowRequests: true,
        requireApproval: false,
        votingEnabled: true,
        allowDownvotes: true,
        maxRequestsPerParticipant: 3,
      },
    });

    await event.save();

    // Create owner as EventMember with DJ role (full permissions)
    const eventMember = new EventMemberModel({
      eventId: event._id,
      userId: ownerId,
      role: "DJ",
      permissions: defaultPermissionsForRole("DJ"),
      addedBy: ownerId,
    });

    await eventMember.save();

    logger.info(`Event created: ${event._id} by ${ownerId}`);

    return this._formatEvent(event);
  }

  async getEvent(eventId) {
    const event = await EventModel.findById(eventId).populate("ownerId", "email displayName");
    if (!event) {
      throw new Error("Event not found");
    }
    return this._formatEvent(event);
  }

  async getEventByAccessCode(accessCode) {
    const event = await EventModel.findOne({ accessCode: accessCode.toUpperCase() }).populate("ownerId", "email displayName");
    if (!event) {
      throw new Error("Event not found");
    }
    return this._formatEvent(event);
  }

  async listActiveEvents(limit = 50, skip = 0) {
    const events = await EventModel.find({ state: "LIVE" })
      .populate("ownerId", "email displayName")
      .limit(limit)
      .skip(skip)
      .sort({ startsAt: -1 });

    return events.map((e) => this._formatEvent(e));
  }

  async updateEvent(eventId, ownerId, updates) {
    const event = await EventModel.findById(eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    // Check ownership
    if (event.ownerId.toString() !== ownerId.toString()) {
      throw new Error("Unauthorized");
    }

    // Allow updating: name, description, settings
    if (updates.name) event.name = updates.name;
    if (updates.description) event.description = updates.description;
    if (updates.settings) event.settings = { ...event.settings, ...updates.settings };

    await event.save();
    logger.info(`Event updated: ${eventId}`);

    return this._formatEvent(event);
  }

  async startEvent(eventId, userId) {
    const event = await EventModel.findById(eventId);
    if (!event) throw new Error("Event not found");
    if (event.ownerId.toString() !== userId.toString()) throw new Error("Unauthorized");

    event.state = "LIVE";
    await event.save();

    await EventActionLogModel.create({
      eventId,
      actorUserId: userId,
      type: "EVENT_START",
    });

    logger.info(`Event started: ${eventId}`);
    return this._formatEvent(event);
  }

  async endEvent(eventId, userId) {
    const event = await EventModel.findById(eventId);
    if (!event) throw new Error("Event not found");
    if (event.ownerId.toString() !== userId.toString()) throw new Error("Unauthorized");

    event.state = "ENDED";
    event.endedAt = new Date();
    await event.save();

    await EventActionLogModel.create({
      eventId,
      actorUserId: userId,
      type: "EVENT_END",
    });

    logger.info(`Event ended: ${eventId}`);
    return this._formatEvent(event);
  }

  async cancelEvent(eventId, userId, reason) {
    const event = await EventModel.findById(eventId);
    if (!event) throw new Error("Event not found");
    if (event.ownerId.toString() !== userId.toString()) throw new Error("Unauthorized");

    event.state = "CANCELLED";
    event.cancelledAt = new Date();
    event.cancelledReason = reason;
    await event.save();

    await EventActionLogModel.create({
      eventId,
      actorUserId: userId,
      type: "EVENT_CANCEL",
      meta: { reason },
    });

    logger.info(`Event cancelled: ${eventId}`);
    return this._formatEvent(event);
  }

  async getEventParticipants(eventId) {
    const participants = await ParticipantModel.find({ eventId, leftAt: null });
    return participants;
  }

  async getEventParticipantCount(eventId) {
    return await ParticipantModel.countDocuments({ eventId, leftAt: null });
  }

  async addEventMember(eventId, userId, role, actorUserId) {
    // Check if already a member
    const existing = await EventMemberModel.findOne({ eventId, userId });
    if (existing) {
      throw new Error("User is already an event member");
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
      ownerId: event.ownerId._id || event.ownerId,
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
}

module.exports = new EventsService();
