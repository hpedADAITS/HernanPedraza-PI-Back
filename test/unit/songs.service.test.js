/**
 * Unit tests for songsService.js - UNMOCKED
 * Tests song suggestion, approval, rejection, queue management using REAL implementations
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  SongModel,
  EventModel,
  AudioTrackModel,
  ParticipantModel,
  UserModel,
  VoteModel,
} = require('../../src/models/schema');
const songsService = require('../../src/services/songs.service');
const participantsService = require('../../src/services/participants.service');
const eventPermissionsService = require('../../src/services/event-permissions.service');
const musicBrainzService = require('../../src/services/musicbrainz.service');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([
    SongModel.deleteMany({}),
    EventModel.deleteMany({}),
    AudioTrackModel.deleteMany({}),
    ParticipantModel.deleteMany({}),
    UserModel.deleteMany({}),
    VoteModel.deleteMany({}),
  ]);
});

// Helper to create a real test event
const createTestEvent = async (overrides = {}) => {
  const user = await UserModel.create({
    email: `dj-${Date.now()}@test.com`,
    passwordHash: 'hashed',
    displayName: 'Test DJ',
    role: 'DJ',
    isActive: true,
  });

  const event = await EventModel.create({
    name: 'Test Event',
    ownerId: user._id,
    eventId: `EVENT-${Date.now()}`,
    accessCode: `TEST${Date.now()}CODE`,
    state: 'LIVE',
    startsAt: new Date(),
    ...overrides,
  });

  return { event, user };
};

// Helper to create a real participant with user
const createTestParticipant = async (eventId, overrides = {}) => {
  const nickname = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const userEmail = `participant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@test.com`;
  const user = await UserModel.create({
    email: userEmail,
    passwordHash: 'hashed',
    displayName: nickname,
    role: 'ATTENDEE',
    isActive: true,
  });
  
  const participant = await ParticipantModel.create({
    eventId,
    nickname,
    isBanned: false,
    leftAt: null,
    userId: user._id,
    ...overrides,
  });
  
  participant.userId = user._id;
  await participant.save();
  
  return participant;
};

// Helper to create a real song
const createTestSong = async (eventId, requestedByParticipantId, overrides = {}) => {
  return SongModel.create({
    title: 'Test Song',
    artist: 'Test Artist',
    eventId,
    requestedBy: requestedByParticipantId,
    status: 'PENDING',
    voteScore: 0,
    voteCount: 0,
    sortKey: `${Date.now()}_test-song`,
    ...overrides,
  });
};

describe('SongsService - Real Implementation Tests', () => {
  describe('suggestSong', () => {
    test('should create a new song', async () => {
      const { event, user: djUser } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      // For suggestSong, the actor must be the participant's user (or have matching permissions)
      // We're simulating the participant suggesting a song
      const result = await songsService.suggestSong(
        event._id.toString(),
        participant._id.toString(),
        'Test Song',
        'Test Artist',
        180,
        { userId: participant.userId.toString(), role: 'ATTENDEE' }
      );

      expect(result).toBeDefined();
      expect(result.title).toBe('Test Song');
      expect(result.artist).toBe('Test Artist');
      expect(result.status).toBe('PENDING');
      
      // Verify song was saved
      const savedSong = await SongModel.findById(result.id);
      expect(savedSong).toBeDefined();
    });

    test('stores attendee-confirmed MusicBrainz metadata', async () => {
      jest.spyOn(musicBrainzService, 'findRecordingMatch');
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const musicBrainzMatch = {
        source: 'musicbrainz',
        recordingId: 'mb-recording-1',
        releaseId: 'mb-release-1',
        title: 'Matched Song',
        artist: 'Matched Artist',
        coverUrl: 'https://example.test/cover.jpg',
        duration: 181,
        score: 0.94,
        matchedOn: 'title_artist',
      };

      const result = await songsService.suggestSong(
        event._id.toString(),
        participant._id.toString(),
        'Test Song',
        'Test Artist',
        undefined,
        { userId: participant.userId.toString(), role: 'ATTENDEE' },
        { musicBrainzConfirmed: true, musicBrainzMatch },
      );

      expect(result.recognitionMatch).toMatchObject(musicBrainzMatch);
      expect(result.recognitionMatch.metadataSha512).toMatch(/^[a-f0-9]{128}$/);
      expect(musicBrainzService.findRecordingMatch).not.toHaveBeenCalled();
    });

    test('assigns accepted MusicBrainz metadata to a fingerprinted track', async () => {
      const { event, user: djUser } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, {
        recognitionMatch: {
          source: 'musicbrainz',
          recordingId: 'mb-recording-1',
          releaseId: 'mb-release-1',
          metadataSha512: 'a'.repeat(128),
          title: 'Matched Song',
          artist: 'Matched Artist',
          coverUrl: 'https://example.test/cover.jpg',
          duration: 181,
          score: 0.94,
          matchedOn: 'title_artist',
        },
      });
      const track = await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'audio-1',
        title: 'Old Song',
        artist: 'Old Artist',
        coverUrl: null,
        uploadedBy: djUser._id,
        duration: 180,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });

      const result = await songsService.assignMusicBrainzMetadataToTrack(
        event._id.toString(),
        song._id.toString(),
        track._id.toString(),
        { userId: djUser._id.toString(), role: 'DJ' },
      );

      expect(result.song.recognitionMatch).toMatchObject({
        source: 'musicbrainz',
        trackId: track._id,
        metadataSha512: 'a'.repeat(128),
        title: 'Matched Song',
        artist: 'Matched Artist',
      });
      expect(result.track).toMatchObject({
        title: 'Matched Song',
        artist: 'Matched Artist',
        coverUrl: 'https://example.test/cover.jpg',
        musicBrainzMetadataSha512: 'a'.repeat(128),
      });
    });

    test('skips MusicBrainz metadata when attendee declines match', async () => {
      jest.spyOn(musicBrainzService, 'findRecordingMatch');
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      const result = await songsService.suggestSong(
        event._id.toString(),
        participant._id.toString(),
        'Original Song',
        'Original Artist',
        undefined,
        { userId: participant.userId.toString(), role: 'ATTENDEE' },
        { skipMusicBrainzLookup: true },
      );

      expect(result.title).toBe('Original Song');
      expect(result.artist).toBe('Original Artist');
      expect(result.recognitionMatch).toBeNull();
      expect(musicBrainzService.findRecordingMatch).not.toHaveBeenCalled();
    });
  });

  describe('getQueueForEvent', () => {
    test('should return sorted queue with positions', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      // Create songs with different statuses and scores
      await createTestSong(event._id, participant._id, {
        title: 'Song A',
        status: 'APPROVED',
        voteScore: 5,
        pinned: false,
        sortKey: '1_a',
      });
      await createTestSong(event._id, participant._id, {
        title: 'Song B',
        status: 'PLAYING',
        voteScore: 3,
        pinned: true,
        sortKey: '2_b',
      });
      await createTestSong(event._id, participant._id, {
        title: 'Song C',
        status: 'APPROVED',
        voteScore: 3,
        pinned: false,
        sortKey: '3_c',
      });

      const result = await songsService.getQueueForEvent(event._id.toString());

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      
      // PLAYING should be first with position 0
      const playingSong = result.find(s => s.status === 'PLAYING');
      expect(playingSong.queuePosition).toBe(0);
    });

    test('should return empty array when no songs in queue', async () => {
      const { event } = await createTestEvent();

      const result = await songsService.getQueueForEvent(event._id.toString());

      expect(result).toEqual([]);
    });
  });

  describe('getPendingSongsForEvent', () => {
    test('should return pending songs', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      await createTestSong(event._id, participant._id, { title: 'Pending 1' });
      await createTestSong(event._id, participant._id, { title: 'Pending 2' });
      await createTestSong(event._id, participant._id, { title: 'Approved 1', status: 'APPROVED' });

      const result = await songsService.getPendingSongsForEvent(event._id.toString());

      expect(result).toHaveLength(2);
      expect(result.every(s => s.status === 'PENDING')).toBe(true);
    });
  });

  describe('approveSong', () => {
    test('should approve a pending song', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id);

      const result = await songsService.approveSong(
        song._id.toString(),
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' }
      );

      expect(result.status).toBe('APPROVED');
      
      // Verify song was updated
      const updatedSong = await SongModel.findById(song._id);
      expect(updatedSong.status).toBe('APPROVED');
    });

    test('should throw NotFoundError when song not found', async () => {
      const { event, user } = await createTestEvent();
      const fakeId = new mongoose.Types.ObjectId();

      await expect(
        songsService.approveSong(fakeId.toString(), event._id.toString(), { userId: user._id.toString(), role: 'DJ' })
      ).rejects.toThrow('Song not found');
    });

    test('should throw NotFoundError when song belongs to different event', async () => {
      const { event: event1, user } = await createTestEvent();
      const { event: event2 } = await createTestEvent();
      const participant = await createTestParticipant(event2._id);
      const song = await createTestSong(event2._id, participant._id);

      await expect(
        songsService.approveSong(song._id.toString(), event1._id.toString(), { userId: user._id.toString(), role: 'DJ' })
      ).rejects.toThrow('Song not in this event');
    });
  });

  describe('rejectSong', () => {
    test('should reject a song with reason', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id);

      const result = await songsService.rejectSong(
        song._id.toString(),
        event._id.toString(),
        'Inappropriate content',
        { userId: user._id.toString(), role: 'DJ' }
      );

      expect(result.status).toBe('REJECTED');
      
      // Verify song was updated
      const updatedSong = await SongModel.findById(song._id);
      expect(updatedSong.status).toBe('REJECTED');
      // Note: removalReason is logged but not stored on the model
    });
  });

  describe('sendNow', () => {
    test('should mark song as playing and update event', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, { status: 'APPROVED' });

      const result = await songsService.sendNow(
        song._id.toString(),
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' }
      );

      expect(result.status).toBe('PLAYING');
      
      // Verify song was updated
      const updatedSong = await SongModel.findById(song._id);
      expect(updatedSong.status).toBe('PLAYING');
      
      // Verify event was updated
      const updatedEvent = await EventModel.findById(event._id);
      expect(updatedEvent.currentSongId?.toString()).toBe(song._id.toString());
    });

    test('should clear other PLAYING songs when sending new song', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      
      // Create a currently playing song
      await createTestSong(event._id, participant._id, {
        title: 'Currently Playing',
        status: 'PLAYING',
        startedPlayingAt: new Date(),
      });
      
      // Create the next song to play
      const nextSong = await createTestSong(event._id, participant._id, {
        title: 'Next Song',
        status: 'APPROVED',
      });

      await songsService.sendNow(
        nextSong._id.toString(),
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' }
      );

      // Verify first song was set to PLAYED
      const playedSongs = await SongModel.find({ eventId: event._id, status: 'PLAYED' });
      expect(playedSongs.length).toBe(1);
    });
  });

  describe('playNextSong', () => {
    test('should play next approved song in queue', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      
      // Create approved songs
      await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        voteScore: 3,
        sortKey: '1',
      });
      const song2 = await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        voteScore: 5,
        sortKey: '2',
      });

      const result = await songsService.playNextSong(
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' }
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('PLAYING');
    });

    test('should return null when no approved songs remain', async () => {
      const { event, user } = await createTestEvent();

      const result = await songsService.playNextSong(
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' }
      );

      expect(result).toBeNull();
    });
  });

  describe('getSongPosition', () => {
    test('should return position in queue', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      const song1 = await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        voteScore: 5,
        sortKey: '1',
      });
      await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        voteScore: 3,
        sortKey: '2',
      });

      const result = await songsService.getSongPosition(song1._id.toString());

      expect(result.position).toBe(1);
    });

    test('should return null position when song not in queue', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      // Create a song that is not in the queue (REJECTED status)
      const rejectedSong = await createTestSong(event._id, participant._id, {
        status: 'REJECTED',
      });

      const result = await songsService.getSongPosition(rejectedSong._id.toString());

      expect(result.position).toBeNull();
    });
  });

  describe('_withQueuePositions', () => {
    test('should assign PLAYING song position 0', () => {
      const songs = [
        { _id: 'song-1', status: 'APPROVED', voteScore: 3, pinned: false, sortKey: 'a' },
        { _id: 'song-2', status: 'PLAYING', voteScore: 5, pinned: false, sortKey: 'b' },
        { _id: 'song-3', status: 'APPROVED', voteScore: 1, pinned: false, sortKey: 'c' },
      ];

      const result = songsService._withQueuePositions(songs);

      const playingSong = result.find(s => s.status === 'PLAYING');
      expect(playingSong.queuePosition).toBe(0);
    });

    test('should sort by pinned, voteScore, then sortKey', () => {
      const songs = [
        { _id: 'a', status: 'APPROVED', voteScore: 1, pinned: false, sortKey: 'c' },
        { _id: 'b', status: 'APPROVED', voteScore: 5, pinned: false, sortKey: 'a' },
        { _id: 'c', status: 'APPROVED', voteScore: 3, pinned: true, sortKey: 'b' },
      ];

      const result = songsService._withQueuePositions(songs);

      expect(result[0]._id).toBe('c'); // pinned first
      expect(result[1]._id).toBe('b'); // highest voteScore
      expect(result[2]._id).toBe('a'); // lowest voteScore
    });
  });

  describe('getQueueSnapshotForEvent', () => {
    test('should return queue and now playing info', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      await createTestSong(event._id, participant._id, {
        status: 'PLAYING',
        startedPlayingAt: new Date(),
      });

      const result = await songsService.getQueueSnapshotForEvent(event._id.toString());

      expect(result.queue).toBeDefined();
      expect(result.nowPlaying).toBeDefined();
      expect(result.nowPlaying.songId).toBeDefined();
    });

    test('should return null nowPlaying when nothing is playing', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      await createTestSong(event._id, participant._id, { status: 'APPROVED' });

      const result = await songsService.getQueueSnapshotForEvent(event._id.toString());

      expect(result.nowPlaying).toBeNull();
    });
  });
});
