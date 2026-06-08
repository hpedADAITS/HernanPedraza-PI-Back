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
const textCrypto = require('../../src/services/text-crypto');

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

// Helper to create a real AudioTrack (required by sendNow/playNextSong tests
// which must attach a recognitionMatch.trackId to drive the Now Playing path).
const createTestAudioTrack = async (eventId, uploadedByUserId, overrides = {}) =>
  AudioTrackModel.create({
    eventId,
    title: 'Test Song',
    artist: 'Test Artist',
    uploadedBy: uploadedByUserId,
    duration: 200,
    sampleRate: 8000,
    pointsCount: 1,
    hashesCount: 1,
    ...overrides,
  });

describe('SongsService - Real Implementation Tests', () => {
  describe('suggestSong', () => {
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
      const downloadedCover = Buffer.from('fake-cover');
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
        arrayBuffer: async () => downloadedCover,
      });
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
        coverUrl: `data:image/jpeg;base64,${downloadedCover.toString('base64')}`,
        musicBrainzMetadataSha512: 'a'.repeat(128),
      });
      const storedTrack = await AudioTrackModel.findById(track._id).lean();
      expect(storedTrack.coverUrl).toMatch(/^enc-cover:v1:/);
      expect(storedTrack.coverUrl).not.toContain('https://example.test/cover.jpg');
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

    test('uses selected DJ fingerprint metadata over attendee text', async () => {
      jest.spyOn(musicBrainzService, 'findRecordingMatch');
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const track = await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'selected-library-track',
        title: 'Canonical Library Title',
        artist: 'Canonical Library Artist',
        uploadedBy: user._id,
        duration: 222,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });

      const result = await songsService.suggestSong(
        event._id.toString(),
        participant._id.toString(),
        'Attendee Typo Title',
        'Attendee Typo Artist',
        111,
        { userId: participant.userId.toString(), role: 'ATTENDEE' },
        { fingerprintTrackId: track._id.toString(), skipMusicBrainzLookup: true },
      );

      expect(result).toMatchObject({
        title: 'Canonical Library Title',
        artist: 'Canonical Library Artist',
        totalDuration: 222,
      });
      expect(result.recognitionMatch).toMatchObject({
        source: 'fingerprint',
        trackId: track._id,
        title: 'Canonical Library Title',
        artist: 'Canonical Library Artist',
        duration: 222,
        score: 1,
        matchedOn: 'fingerprint',
      });
      expect(musicBrainzService.findRecordingMatch).not.toHaveBeenCalled();
    });

    test('falls back to strict local fingerprint match when MusicBrainz returns no match', async () => {
      const findRecordingMatch = jest
        .spyOn(musicBrainzService, 'findRecordingMatch')
        .mockResolvedValue(null);
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const track = await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'fallback-audio-1',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        uploadedBy: user._id,
        duration: 354,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });

      const result = await songsService.suggestSong(
        event._id.toString(),
        participant._id.toString(),
        'Bohemian Rhapsody',
        'Queen',
        354,
        { userId: participant.userId.toString(), role: 'ATTENDEE' },
      );

      expect(findRecordingMatch).toHaveBeenCalled();
      expect(result.recognitionMatch).toMatchObject({
        source: 'local',
        trackId: track._id,
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        fallbackUsed: true,
        matchedOn: 'title_artist',
      });
      expect(result.recognitionMatch.score).toBeGreaterThan(0.5);

      let stored = await SongModel.findById(result._id).lean();
      expect(textCrypto.isEncrypted(stored.title)).toBe(true);
      expect(textCrypto.isEncrypted(stored.artist)).toBe(true);
      expect(textCrypto.isEncrypted(stored.recognitionMatch.title)).toBe(true);
      expect(textCrypto.isEncrypted(stored.recognitionMatch.artist)).toBe(true);

      await songsService.approveSong(
        result._id.toString(),
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' },
      );
      const playing = await songsService.sendNow(
        result._id.toString(),
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' },
      );
      expect(playing.title).toBe('Bohemian Rhapsody');
      expect(playing.artist).toBe('Queen');
      expect(playing.recognitionMatch.title).toBe('Bohemian Rhapsody');
      expect(playing.recognitionMatch.artist).toBe('Queen');

      stored = await SongModel.findById(result._id).lean();
      expect(textCrypto.isEncrypted(stored.title)).toBe(true);
      expect(textCrypto.isEncrypted(stored.artist)).toBe(true);
      expect(textCrypto.isEncrypted(stored.recognitionMatch.title)).toBe(true);
      expect(textCrypto.isEncrypted(stored.recognitionMatch.artist)).toBe(true);

      const snapshot = await songsService.getQueueSnapshotForEvent(event._id.toString());
      expect(snapshot.queue[0].title).toBe('Bohemian Rhapsody');
      expect(snapshot.queue[0].artist).toBe('Queen');
      expect(snapshot.nowPlaying.title).toBe('Bohemian Rhapsody');
      expect(snapshot.nowPlaying.artist).toBe('Queen');
    });

    test('falls back to lenient local fingerprint when MusicBrainz fails and stores alternates', async () => {
      jest
        .spyOn(musicBrainzService, 'findRecordingMatch')
        .mockResolvedValue(null);
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      // Tracks chosen so they won't pass the strict matchedOn thresholds
      // (artist-score >= 0.9 OR title-score >= 0.86 OR title_artist combined).
      // This forces the lenient fallback path to be exercised.
      await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'lib-1',
        title: 'Bohemian Rap (Tribute)',
        artist: 'Tribute Band',
        uploadedBy: user._id,
        duration: 354,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });
      await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'lib-2',
        title: 'Bohemian Rhapsody Live Version',
        artist: 'Queen Tribute',
        uploadedBy: user._id,
        duration: 354,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });
      // Unrelated — must be filtered out by the 0.35 min-score floor.
      await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'lib-3',
        title: 'Some Other Track',
        artist: 'Unrelated Artist',
        uploadedBy: user._id,
        duration: 100,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });

      const result = await songsService.suggestSong(
        event._id.toString(),
        participant._id.toString(),
        'Bohemian Rhapsody',
        'Queen',
        354,
        { userId: participant.userId.toString(), role: 'ATTENDEE' },
      );

      expect(result.recognitionMatch).not.toBeNull();
      expect(result.recognitionMatch.fallbackUsed).toBe(true);
      expect(result.recognitionMatch.alternates).toBeDefined();
      expect(result.recognitionMatch.alternates.length).toBeGreaterThan(0);
      // Top score becomes the auto-pick; rest live in alternates.
      const allTrackIds = [
        result.recognitionMatch.trackId,
        ...result.recognitionMatch.alternates.map((alt) => alt.trackId),
      ];
      expect(allTrackIds.length).toBeGreaterThan(1);
      // The unrelated track should be filtered out by the 0.35 min-score floor.
      const unrelated = [...allTrackIds].find((id) => {
        const allAlternates = result.recognitionMatch.alternates;
        const match = allAlternates.find((alt) => String(alt.trackId) === String(id));
        return match?.title === 'Some Other Track';
      });
      expect(unrelated).toBeUndefined();
    });

    test('MusicBrainz match wins over local fingerprint candidate', async () => {
      jest.spyOn(musicBrainzService, 'findRecordingMatch').mockResolvedValue({
        source: 'musicbrainz',
        recordingId: 'mb-1',
        releaseId: 'mb-rel-1',
        title: 'MB Title',
        artist: 'MB Artist',
        coverUrl: null,
        duration: 200,
        score: 0.9,
        matchedOn: 'title_artist',
      });
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const track = await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'local-1',
        title: 'MB Title',
        artist: 'MB Artist',
        uploadedBy: user._id,
        duration: 200,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });

      const result = await songsService.suggestSong(
        event._id.toString(),
        participant._id.toString(),
        'MB Title',
        'MB Artist',
        200,
        { userId: participant.userId.toString(), role: 'ATTENDEE' },
      );

      expect(result.recognitionMatch.source).toBe('musicbrainz');
      // trackId is only set by the assign endpoint, not auto on MB match
      expect(result.recognitionMatch.trackId).toBeUndefined();
      const stored = await SongModel.findById(result.id);
      expect(stored.recognitionMatch.source).toBe('musicbrainz');
      expect(String(stored.recognitionMatch.trackId || '')).not.toBe(String(track._id));
    });
  });

  describe('getFingerprintMatchCandidates', () => {
    test('returns tracks ranked against the original attendee query', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, {
        title: 'Original Title',
        artist: 'Original Artist',
      });
      const closer = await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'close-1',
        title: 'Original Title',
        artist: 'Original Artist',
        uploadedBy: user._id,
        duration: 200,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });
      const other = await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'other-1',
        title: 'Original Title Live',
        artist: 'Original Artist Band',
        uploadedBy: user._id,
        duration: 220,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });

      const result = await songsService.getFingerprintMatchCandidates(
        event._id.toString(),
        song._id.toString(),
        { userId: user._id.toString(), role: 'DJ' },
      );

      expect(result.target).toEqual({ title: 'Original Title', artist: 'Original Artist' });
      expect(result.tracks.length).toBe(2);
      expect(String(result.tracks[0].id)).toBe(String(closer._id));
      expect(String(result.tracks[0]._id)).toBe(String(closer._id));
      expect(result.tracks[0].matchScore).toBeGreaterThan(result.tracks[1].matchScore);
      expect(result.tracks.map((t) => String(t.id))).toContain(String(other._id));
    });

    test('rejects non-DJ actors', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id);
      await expect(
        songsService.getFingerprintMatchCandidates(
          event._id.toString(),
          song._id.toString(),
          { userId: participant.userId.toString(), role: 'ATTENDEE' },
        ),
      ).rejects.toThrow(/permission/);
    });
  });

  describe('searchFingerprints', () => {
    test('returns ranked matches with cover art for the attendee typeahead', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const encryptedCover = 'enc-cover:v1:abc';
      await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'lib-1',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        coverUrl: encryptedCover,
        uploadedBy: user._id,
        duration: 354,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });
      await AudioTrackModel.create({
        eventId: event._id,
        audioSha256: 'lib-2',
        title: 'Bohemian Rhapsody (Remastered)',
        artist: 'Queen',
        coverUrl: null,
        uploadedBy: user._id,
        duration: 354,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });
      // Track in a different event — must not leak into results
      const { event: otherEvent, user: otherDj } = await createTestEvent();
      await AudioTrackModel.create({
        eventId: otherEvent._id,
        audioSha256: 'lib-3',
        title: 'Bohemian Rhapsody',
        artist: 'Queen',
        coverUrl: null,
        uploadedBy: otherDj._id,
        duration: 354,
        sampleRate: 8000,
        pointsCount: 1,
        hashesCount: 1,
      });

      const result = await songsService.searchFingerprints(
        event._id.toString(),
        participant._id.toString(),
        'Bohemian Rhapsody',
        'Queen',
        { userId: participant.userId.toString(), role: 'ATTENDEE' },
      );

      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].matchScore).toBeGreaterThan(result.matches[1].matchScore);
      // Covers come back decrypted (null when encryption is opaque) — but the
      // first match should expose a coverUrl key in its shape.
      expect(result.matches[0]).toHaveProperty('coverUrl');
    });

    test('returns empty matches when query is empty', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);

      const result = await songsService.searchFingerprints(
        event._id.toString(),
        participant._id.toString(),
        '',
        '',
        { userId: participant.userId.toString(), role: 'ATTENDEE' },
      );

      expect(result.matches).toEqual([]);
    });

    test('refuses requests from non-participants', async () => {
      const { event, user: djUser } = await createTestEvent();
      await expect(
        songsService.searchFingerprints(
          event._id.toString(),
          '60a7b8c9d0e1f2a3b4c5d6e7',
          'Some Title',
          'Some Artist',
          { userId: djUser._id.toString(), role: 'DJ' },
        ),
      ).rejects.toThrow();
    });
  });

  describe('lookupMusicBrainz', () => {
    test('throttles repeated attendee lookups before MusicBrainz', async () => {
      const { event } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const actor = { userId: participant.userId.toString(), role: 'ATTENDEE' };
      const findRecordingMatches = jest
        .spyOn(musicBrainzService, 'findRecordingMatches')
        .mockResolvedValue([{ source: 'musicbrainz', title: 'Song', artist: 'Artist', score: 1 }]);

      const first = await songsService.lookupMusicBrainz(
        event._id.toString(),
        participant._id.toString(),
        'Song',
        'Artist',
        undefined,
        actor,
      );
      const second = await songsService.lookupMusicBrainz(
        event._id.toString(),
        participant._id.toString(),
        'Song',
        'Artist',
        undefined,
        actor,
      );

      expect(first).toHaveLength(1);
      expect(second).toEqual([]);
      expect(findRecordingMatches).toHaveBeenCalledTimes(1);
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
      const track = await createTestAudioTrack(event._id, user._id);
      const song = await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        recognitionMatch: { trackId: track._id, title: track.title, artist: track.artist, score: 1, matchedOn: 'title' },
      });

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
      const track = await createTestAudioTrack(event._id, user._id);

      // Create a currently playing song
      await createTestSong(event._id, participant._id, {
        title: 'Currently Playing',
        status: 'PLAYING',
        startedPlayingAt: new Date(),
        recognitionMatch: { trackId: track._id, title: 'Currently Playing', artist: 'Test Artist', score: 1, matchedOn: 'title' },
      });

      // Create the next song to play
      const nextSong = await createTestSong(event._id, participant._id, {
        title: 'Next Song',
        status: 'APPROVED',
        recognitionMatch: { trackId: track._id, title: 'Next Song', artist: 'Test Artist', score: 1, matchedOn: 'title' },
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

    test('throws MatchRequiredError when song has no recognitionMatch.trackId', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, { status: 'APPROVED' });

      const { MatchRequiredError } = require('../../src/errors');
      await expect(
        songsService.sendNow(
          song._id.toString(),
          event._id.toString(),
          { userId: user._id.toString(), role: 'DJ' },
        ),
      ).rejects.toBeInstanceOf(MatchRequiredError);

      const stillApproved = await SongModel.findById(song._id);
      expect(stillApproved.status).toBe('APPROVED');
    });

    test('throws MatchRequiredError when recognitionMatch exists but trackId is missing', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const song = await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        recognitionMatch: { title: 'Unmatched', artist: 'No Track', score: 0.4, matchedOn: 'title' },
      });

      const { MatchRequiredError } = require('../../src/errors');
      await expect(
        songsService.sendNow(
          song._id.toString(),
          event._id.toString(),
          { userId: user._id.toString(), role: 'DJ' },
        ),
      ).rejects.toBeInstanceOf(MatchRequiredError);
    });
  });

  describe('playNextSong', () => {
    test('should play next approved song in queue', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const track = await createTestAudioTrack(event._id, user._id);

      // Create approved songs
      await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        voteScore: 3,
        sortKey: '1',
        recognitionMatch: { trackId: track._id, title: 'Song 1', artist: 'Test Artist', score: 1, matchedOn: 'title' },
      });
      const song2 = await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        voteScore: 5,
        sortKey: '2',
        recognitionMatch: { trackId: track._id, title: 'Song 2', artist: 'Test Artist', score: 1, matchedOn: 'title' },
      });

      const result = await songsService.playNextSong(
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' }
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('PLAYING');
      expect(result._id.toString()).toBe(song2._id.toString());
    });

    test('should return null when no approved songs remain', async () => {
      const { event, user } = await createTestEvent();

      const result = await songsService.playNextSong(
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' }
      );

      expect(result).toBeNull();
    });

    test('skips approved songs without a fingerprint trackId', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const track = await createTestAudioTrack(event._id, user._id);

      // This song has no recognitionMatch at all - should be skipped
      const unmatched = await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        voteScore: 99,
        sortKey: 'a',
      });

      // This one is properly matched
      const matched = await createTestSong(event._id, participant._id, {
        status: 'APPROVED',
        voteScore: 1,
        sortKey: 'b',
        recognitionMatch: { trackId: track._id, title: 'Matched', artist: 'Test Artist', score: 1, matchedOn: 'title' },
      });

      const result = await songsService.playNextSong(
        event._id.toString(),
        { userId: user._id.toString(), role: 'DJ' },
      );

      expect(result).not.toBeNull();
      expect(result._id.toString()).toBe(matched._id.toString());
      expect(result.status).toBe('PLAYING');

      const stillApproved = await SongModel.findById(unmatched._id);
      expect(stillApproved.status).toBe('APPROVED');
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

    test('should use premium only as a tie-breaker after votes', () => {
      const songs = [
        { _id: 'regular-high', status: 'APPROVED', voteScore: 2, isPremiumSuggestion: false, pinned: false, sortKey: 'a' },
        { _id: 'premium-low', status: 'APPROVED', voteScore: 1, isPremiumSuggestion: true, pinned: false, sortKey: 'b' },
        { _id: 'premium-tie', status: 'APPROVED', voteScore: 2, isPremiumSuggestion: true, pinned: false, sortKey: 'c' },
      ];

      const result = songsService._withQueuePositions(songs);

      expect(result.map((song) => song._id)).toEqual([
        'premium-tie',
        'regular-high',
        'premium-low',
      ]);
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

    test('uses DJ library metadata in queue and now playing display', async () => {
      const { event, user } = await createTestEvent();
      const participant = await createTestParticipant(event._id);
      const track = await createTestAudioTrack(event._id, user._id, {
        title: 'Canonical Queue Title',
        artist: 'Canonical Queue Artist',
        duration: 244,
      });

      await createTestSong(event._id, participant._id, {
        title: 'Attendee Queue Typo',
        artist: 'Attendee Queue Artist',
        totalDuration: 99,
        status: 'PLAYING',
        startedPlayingAt: new Date(),
        recognitionMatch: {
          source: 'fingerprint',
          trackId: track._id,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          score: 1,
          matchedOn: 'fingerprint',
        },
      });

      const result = await songsService.getQueueSnapshotForEvent(event._id.toString());

      expect(result.queue[0]).toMatchObject({
        title: 'Canonical Queue Title',
        artist: 'Canonical Queue Artist',
        totalDuration: 244,
      });
      expect(result.nowPlaying).toMatchObject({
        title: 'Canonical Queue Title',
        artist: 'Canonical Queue Artist',
        totalDuration: 244,
      });
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
