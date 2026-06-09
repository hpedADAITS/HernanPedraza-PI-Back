const { emitMatchDiff } = require('../../src/socket/audio');
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
});
