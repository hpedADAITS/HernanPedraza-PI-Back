const mongoose = require("mongoose");
const bcryptjs = require("bcryptjs");
require("dotenv").config();

const {
  UserModel,
  EventModel,
  EventMemberModel,
  ParticipantModel,
  SongModel,
  VoteModel,
  EventActionLogModel,
  connectMongo,
  defaultPermissionsForRole,
} = require("../src/mongo_schema");

async function seed() {
  try {
    console.log("[INFO] Starting database seed...");

    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/syncrekuest";
    await connectMongo(uri);
    console.log("[INFO] Connected to MongoDB");

    // Clear existing data
    console.log("[INFO] Clearing existing collections...");
    await Promise.all([
      UserModel.deleteMany({}),
      EventModel.deleteMany({}),
      EventMemberModel.deleteMany({}),
      ParticipantModel.deleteMany({}),
      SongModel.deleteMany({}),
      VoteModel.deleteMany({}),
      EventActionLogModel.deleteMany({}),
    ]);
    console.log("[INFO] Collections cleared");

    // Create users
    console.log("[INFO] Creating users...");
    const passwordHash = await bcryptjs.hash("password123", 10);

    const users = await UserModel.insertMany([
      {
        email: "owner@example.com",
        passwordHash,
        displayName: "Event Owner",
        role: "DJ",
        isActive: true,
        lastLoginAt: new Date(),
      },
      {
        email: "dj@example.com",
        passwordHash,
        displayName: "DJ User",
        role: "DJ",
        isActive: true,
        lastLoginAt: new Date(),
      },
      {
        email: "lucas@example.com",
        passwordHash,
        displayName: "Lucas",
        role: "DJ",
        isActive: true,
        lastLoginAt: new Date(),
      },
      {
        email: "moderator@example.com",
        passwordHash,
        displayName: "Moderator",
        role: "ATTENDEE",
        isActive: true,
      },
      {
        email: "admin@example.com",
        passwordHash,
        displayName: "Admin User",
        role: "ADMIN",
        isActive: true,
      },
    ]);
    console.log(`[INFO] Created ${users.length} users`);

    // Create events
    console.log("[INFO] Creating events...");
    const now = new Date();
    const startTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now

    const events = await EventModel.insertMany([
      {
        name: "Weekend Party",
        description: "A great weekend party with amazing music",
        ownerId: users[0]._id,
        accessCode: "PARTY2024",
        state: "DRAFT",
        startsAt: startTime,
        settings: {
          allowRequests: true,
          requireApproval: false,
          votingEnabled: true,
          allowDownvotes: true,
          maxRequestsPerParticipant: 3,
        },
      },
      {
        name: "Office Happy Hour",
        description: "Join us for drinks and music",
        ownerId: users[1]._id,
        accessCode: "OFFICE23",
        state: "LIVE",
        startsAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
        settings: {
          allowRequests: true,
          requireApproval: true,
          votingEnabled: true,
          allowDownvotes: false,
          maxRequestsPerParticipant: 2,
        },
      },
      {
        name: "Past Concert",
        description: "A concert that already happened",
        ownerId: users[0]._id,
        accessCode: "CONCERT21",
        state: "ENDED",
        startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 24 hours ago
        endedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
    ]);
    console.log(`[INFO] Created ${events.length} events`);

    // Create event members
    console.log("[INFO] Creating event members...");
    const eventMembers = await EventMemberModel.insertMany([
      {
        eventId: events[0]._id,
        userId: users[0]._id,
        role: "OWNER",
        permissions: defaultPermissionsForRole("OWNER"),
        addedBy: users[0]._id,
      },
      {
        eventId: events[0]._id,
        userId: users[2]._id,
        role: "MODERATOR",
        permissions: defaultPermissionsForRole("MODERATOR"),
        addedBy: users[0]._id,
      },
      {
        eventId: events[1]._id,
        userId: users[1]._id,
        role: "OWNER",
        permissions: defaultPermissionsForRole("OWNER"),
        addedBy: users[1]._id,
      },
      {
        eventId: events[1]._id,
        userId: users[2]._id,
        role: "DJ",
        permissions: defaultPermissionsForRole("DJ"),
        addedBy: users[1]._id,
      },
    ]);
    console.log(`[INFO] Created ${eventMembers.length} event members`);

    // Create participants
    console.log("[INFO] Creating participants...");
    const participants = await ParticipantModel.insertMany([
      {
        eventId: events[0]._id,
        nickname: "Alice",
        isPremium: true,
        socketId: "socket-001",
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      },
      {
        eventId: events[0]._id,
        nickname: "Bob",
        isPremium: false,
        socketId: "socket-002",
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      },
      {
        eventId: events[0]._id,
        nickname: "Charlie",
        isPremium: false,
        socketId: "socket-003",
        joinedAt: new Date(now.getTime() - 30 * 60 * 1000), // 30 mins ago
        lastSeenAt: new Date(now.getTime() - 30 * 60 * 1000),
      },
      {
        eventId: events[0]._id,
        nickname: "Lucas",
        isPremium: true,
        socketId: "socket-006",
        joinedAt: new Date(now.getTime() - 15 * 60 * 1000),
        lastSeenAt: new Date(now.getTime() - 5 * 60 * 1000),
      },
      {
        eventId: events[1]._id,
        nickname: "Diana",
        isPremium: true,
        socketId: "socket-004",
        joinedAt: new Date(now.getTime() - 60 * 60 * 1000),
        lastSeenAt: new Date(),
      },
      {
        eventId: events[1]._id,
        nickname: "Eve",
        isPremium: false,
        socketId: "socket-005",
        joinedAt: new Date(now.getTime() - 45 * 60 * 1000),
        lastSeenAt: new Date(now.getTime() - 15 * 60 * 1000),
      },
    ]);
    console.log(`[INFO] Created ${participants.length} participants`);

    // Create songs
    console.log("[INFO] Creating songs...");
    const songs = await SongModel.insertMany([
      {
        eventId: events[0]._id,
        title: "Blinding Lights",
        artist: "The Weeknd",
        requestedBy: participants[0]._id,
        status: "PENDING",
        voteScore: 5,
        voteCount: 5,
        queuePosition: 1,
        sortKey: "001",
      },
      {
        eventId: events[0]._id,
        title: "Anti-Hero",
        artist: "Taylor Swift",
        requestedBy: participants[1]._id,
        status: "APPROVED",
        voteScore: 3,
        voteCount: 3,
        queuePosition: 2,
        sortKey: "002",
      },
      {
        eventId: events[0]._id,
        title: "Flowers",
        artist: "Miley Cyrus",
        requestedBy: participants[2]._id,
        status: "PENDING",
        voteScore: -1,
        voteCount: 1,
        queuePosition: 3,
        sortKey: "003",
      },
      {
        eventId: events[1]._id,
        title: "Good as Hell",
        artist: "Lizzo",
        requestedBy: participants[3]._id,
        status: "PLAYING",
        voteScore: 8,
        voteCount: 8,
        queuePosition: 1,
        sortKey: "001",
        startedPlayingAt: new Date(now.getTime() - 3 * 60 * 1000), // 3 mins ago
      },
      {
        eventId: events[1]._id,
        title: "LOVE NWANTITI",
        artist: "CKay",
        requestedBy: participants[4]._id,
        status: "APPROVED",
        voteScore: 5,
        voteCount: 5,
        queuePosition: 2,
        sortKey: "002",
      },
      {
        eventId: events[2]._id,
        title: "Shape of You",
        artist: "Ed Sheeran",
        requestedBy: participants[3]._id,
        status: "PLAYED",
        voteScore: 10,
        voteCount: 10,
        queuePosition: null,
        sortKey: "001",
      },
    ]);
    console.log(`[INFO] Created ${songs.length} songs`);

    // Create votes
    console.log("[INFO] Creating votes...");
    const votes = await VoteModel.insertMany([
      // Votes on "Blinding Lights"
      { songId: songs[0]._id, participantId: participants[0]._id, value: 1 },
      { songId: songs[0]._id, participantId: participants[1]._id, value: 1 },
      { songId: songs[0]._id, participantId: participants[2]._id, value: 1 },
      { songId: songs[0]._id, participantId: participants[3]._id, value: 1 },
      { songId: songs[0]._id, participantId: participants[4]._id, value: 1 },

      // Votes on "Anti-Hero"
      { songId: songs[1]._id, participantId: participants[0]._id, value: 1 },
      { songId: songs[1]._id, participantId: participants[1]._id, value: 1 },
      { songId: songs[1]._id, participantId: participants[3]._id, value: 1 },

      // Votes on "Flowers"
      { songId: songs[2]._id, participantId: participants[4]._id, value: -1 },

      // Votes on "Good as Hell"
      { songId: songs[3]._id, participantId: participants[3]._id, value: 1 },
      { songId: songs[3]._id, participantId: participants[4]._id, value: 1 },
      { songId: songs[3]._id, participantId: participants[0]._id, value: 1 },
      { songId: songs[3]._id, participantId: participants[1]._id, value: 1 },
      { songId: songs[3]._id, participantId: participants[2]._id, value: 1 },
    ]);
    console.log(`[INFO] Created ${votes.length} votes`);

    // Create action logs
    console.log("[INFO] Creating event action logs...");
    const logs = await EventActionLogModel.insertMany([
      {
        eventId: events[0]._id,
        actorUserId: users[0]._id,
        type: "SONG_APPROVE",
        songId: songs[1]._id,
        meta: { note: "Great song choice" },
      },
      {
        eventId: events[1]._id,
        actorUserId: users[1]._id,
        type: "EVENT_START",
        meta: { message: "Event started by DJ" },
      },
      {
        eventId: events[1]._id,
        actorUserId: users[1]._id,
        type: "SONG_STATUS_CHANGE",
        songId: songs[3]._id,
        meta: { oldStatus: "APPROVED", newStatus: "PLAYING" },
      },
    ]);
    console.log(`[INFO] Created ${logs.length} action logs`);

    console.log("[INFO] Database seed completed successfully");
    console.log("[INFO] Summary: Users=" + users.length + ", Events=" + events.length + ", EventMembers=" + eventMembers.length + ", Participants=" + participants.length + ", Songs=" + songs.length + ", Votes=" + votes.length + ", ActionLogs=" + logs.length);
    console.log("[INFO] Test Credentials: owner@example.com/password123 (DJ), dj@example.com/password123 (DJ), lucas@example.com/password123 (DJ), admin@example.com/password123 (Admin)");
    console.log("[INFO] Event Access Codes: PARTY2024 (Draft), OFFICE23 (Live), CONCERT21 (Ended)");

    await mongoose.connection.close();
  } catch (error) {
    console.error("[ERROR] Seed error: " + error.message);
    process.exit(1);
  }
}

seed();
