const { emitMatchDiff, emitMatchDiffAndActions } = require('../../src/socket/audio');
const { EVENT } = require('../../src/services/audio-recognition/match-session');

function createSocketAndIo() {
  const socketEvents = [];
  const roomEvents = [];
  return {
    socket: {
      emit: jest.fn((event, payload) => socketEvents.push({ event, payload })),
    },
    io: {
      to: jest.fn((room) => ({
        emit: jest.fn((event, payload) => roomEvents.push({ room, event, payload })),
      })),
    },
    socketEvents,
    roomEvents,
  };
}

function candidate() {
  return {
    trackId: 'track-1',
    title: 'Song',
    artist: 'Artist',
    score: 12,
    totalAligned: 12,
    offsetConcentration: 1,
    offset: 3,
    queueContext: { hasPlaying: true },
  };
}

function lockedCandidateWithPlaying() {
  const startedPlayingAt = new Date(Date.now() - 60_000).toISOString();
  return {
    trackId: 'track-1',
    title: 'Locked Song',
    artist: 'Locked Artist',
    coverUrl: 'https://example.com/cover.jpg',
    duration: 200,
    score: 18,
    totalAligned: 20,
    offsetConcentration: 0.9,
    offset: 1,
    queueContext: {
      hasMatch: true,
      isInQueue: true,
      hasPlaying: true,
      hasApproved: false,
      hasPending: false,
      nextApproved: null,
      approvedCount: 0,
      playing: {
        songId: 'song-1',
        eventId: 'event-1',
        title: 'Locked Song',
        artist: 'Locked Artist',
        status: 'PLAYING',
        totalDuration: 200,
        duration: 200,
        startedPlayingAt,
      },
    },
  };
}

describe('socket audio match broadcasts', () => {
  test('broadcasts legacy match updates to the event room for dashboard listeners', () => {
    const { socket, io, socketEvents, roomEvents } = createSocketAndIo();

    emitMatchDiff(socket, io, 'event-1', {
      event: EVENT.HOLD_STARTED,
      state: 'holding',
      payload: candidate(),
    });

    expect(socketEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'audio_match_update',
          payload: expect.objectContaining({
            eventId: 'event-1',
            matches: [expect.objectContaining({ trackId: 'track-1' })],
          }),
        }),
      ]),
    );
    expect(roomEvents).toEqual([
      expect.objectContaining({
        room: 'event:event-1',
        event: 'audio_match_update',
        payload: expect.objectContaining({
          matches: [expect.objectContaining({ trackId: 'track-1' })],
        }),
      }),
    ]);
  });

  test('broadcasts empty legacy updates when a match releases', () => {
    const { socket, io, roomEvents } = createSocketAndIo();

    emitMatchDiff(socket, io, 'event-1', {
      event: EVENT.RELEASED,
      state: 'idle',
      payload: { ...candidate(), reason: 'released' },
    });

    expect(roomEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'audio_match_update',
          payload: expect.objectContaining({ matches: [] }),
        }),
        expect.objectContaining({ event: 'audio_match_released' }),
      ]),
    );
  });

  test('clears autoSentTrackId when the released trackId matches the auto-sent one', () => {
    const { socket } = createSocketAndIo();
    socket.audioMatch = { autoSentTrackId: 'track-1' };

    emitMatchDiff(socket, null, 'event-1', {
      event: EVENT.RELEASED,
      state: 'idle',
      payload: { ...candidate(), reason: 'candidate_left_queue' },
    });

    expect(socket.audioMatch.autoSentTrackId).toBe('');
  });

  test('leaves autoSentTrackId alone when the released trackId is different (DJ picked a different track)', () => {
    const { socket } = createSocketAndIo();
    socket.audioMatch = { autoSentTrackId: 'track-1' };

    emitMatchDiff(socket, null, 'event-1', {
      event: EVENT.RELEASED,
      state: 'idle',
      payload: { ...candidate(), trackId: 'track-2', reason: 'dj_intent_other_track' },
    });

    expect(socket.audioMatch.autoSentTrackId).toBe('track-1');
  });

  describe('audio_match_locked -> song_now_playing handoff', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    test('emits song_now_playing to the event room when the locked candidate is already playing', async () => {
      jest.doMock('../../src/services/audio-tracks.service', () => ({
        sendMatchedTrackNow: jest.fn(),
      }));
      jest.doMock('../../src/services/audio-recognition/match-session-registry', () => ({
        applyQueueEventToEvent: jest.fn().mockResolvedValue([]),
      }));
      jest.doMock('../../src/services', () => ({
        songsService: {
          getQueueSnapshotForEvent: jest.fn().mockResolvedValue({
            queue: [],
            nowPlaying: null,
          }),
        },
        audioTracksService: {
          sendMatchedTrackNow: jest.fn(),
        },
        sharedRamMatcher: {},
      }));
      jest.doMock('../../src/models/schema', () => ({
        EventModel: { findById: jest.fn() },
        SongModel: {},
        AudioTrackModel: {},
      }));

      const audio = require('../../src/socket/audio');
      const { socket, io, roomEvents } = createSocketAndIo();
      socket.audioMatch = {};
      const playing = lockedCandidateWithPlaying();

      await audio.emitMatchDiffAndActions(socket, io, 'event-1', {
        event: EVENT.LOCKED,
        state: 'locked',
        payload: playing,
      });

      const nowPlaying = roomEvents.find((e) => e.event === 'song_now_playing');
      expect(nowPlaying).toBeDefined();
      expect(nowPlaying.payload).toEqual(
        expect.objectContaining({
          eventId: 'event-1',
          songId: 'song-1',
          status: 'PLAYING',
          title: 'Locked Song',
          artist: 'Locked Artist',
          albumArt: 'https://example.com/cover.jpg',
          trackId: 'track-1',
        }),
      );
      // totalDuration / duration should be the playing song's duration
      expect(nowPlaying.payload.totalDuration).toBe(200);
      expect(nowPlaying.payload.startedPlayingAt).toBe(playing.queueContext.playing.startedPlayingAt);
    });

    test('does not emit song_now_playing when the locked candidate has no queue context', async () => {
      jest.doMock('../../src/services/audio-tracks.service', () => ({
        sendMatchedTrackNow: jest.fn(),
      }));
      jest.doMock('../../src/services/audio-recognition/match-session-registry', () => ({
        applyQueueEventToEvent: jest.fn().mockResolvedValue([]),
      }));
      jest.doMock('../../src/services', () => ({
        songsService: { getQueueSnapshotForEvent: jest.fn() },
        audioTracksService: { sendMatchedTrackNow: jest.fn() },
        sharedRamMatcher: {},
      }));
      jest.doMock('../../src/models/schema', () => ({
        EventModel: { findById: jest.fn() },
        SongModel: {},
        AudioTrackModel: {},
      }));

      const audio = require('../../src/socket/audio');
      const { socket, io, roomEvents } = createSocketAndIo();
      socket.audioMatch = {};
      await audio.emitMatchDiffAndActions(socket, io, 'event-1', {
        event: EVENT.LOCKED,
        state: 'locked',
        payload: {
          trackId: 'track-orphan',
          title: 'Orphan Track',
          artist: 'No Match',
          queueContext: {
            hasMatch: false,
            hasPlaying: false,
            hasApproved: false,
            hasPending: false,
            nextApproved: null,
          },
        },
      });

      expect(roomEvents.find((e) => e.event === 'song_now_playing')).toBeUndefined();
    });
  });
});
