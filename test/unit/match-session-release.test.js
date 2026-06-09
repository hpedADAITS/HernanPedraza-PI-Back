jest.mock('../../src/services/audio-recognition/queue-linker', () => ({
  enrichMatchesWithQueueContext: jest.fn(),
  bindRecognitionMatchToPendingSong: jest.fn(),
  findUpNextQueueTrack: jest.fn(),
}));

const queueLinker = require('../../src/services/audio-recognition/queue-linker');
const { MatchSession, EVENT, STATE } = require('../../src/services/audio-recognition/match-session');

function match(trackId, score = 12) {
  return {
    trackId,
    score,
    offset: 0,
    totalAligned: score,
    offsetConcentration: 1,
    title: `Track ${trackId}`,
    artist: 'Artist',
  };
}

function withQueueContext(candidate, { playing = false, approved = false } = {}) {
  return {
    ...candidate,
    queueContext: {
      trackId: candidate.trackId,
      hasMatch: true,
      isInQueue: true,
      hasApproved: approved,
      hasPlaying: playing,
      nextApproved: approved
        ? { songId: `song-${candidate.trackId}-approved`, trackId: candidate.trackId, status: 'APPROVED' }
        : null,
      playing: playing
        ? { songId: `song-${candidate.trackId}-playing`, trackId: candidate.trackId, status: 'PLAYING' }
        : null,
      approvedCount: approved ? 1 : 0,
      isPlayableNow: playing || approved,
      suggestedAction: playing ? 'already_playing' : approved ? 'send_now' : 'no_queue_entry',
    },
  };
}

function emptyContext(candidate) {
  return {
    ...candidate,
    queueContext: {
      trackId: candidate.trackId,
      hasMatch: false,
      isInQueue: false,
      hasApproved: false,
      hasPlaying: false,
      nextApproved: null,
      playing: null,
      approvedCount: 0,
      isPlayableNow: false,
      suggestedAction: 'no_queue_entry',
    },
  };
}

describe('MatchSession release on PLAYING -> other state transitions', () => {
  beforeEach(() => {
    queueLinker.enrichMatchesWithQueueContext.mockReset();
    queueLinker.findUpNextQueueTrack.mockReset();
    queueLinker.bindRecognitionMatchToPendingSong.mockReset();
  });

  test('releases locked session when the PLAYING candidate transitions to PLAYED (song_skipped)', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => withQueueContext(c, { playing: true })))
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => emptyContext(c)));

    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    const diffs = await session.applyQueueEvent({ type: 'song_skipped', trackId: 't1' });

    expect(diffs.some((d) => d.event === EVENT.RELEASED)).toBe(true);
    expect(session.getState().state).toBe(STATE.IDLE);
  });

  test('releases locked session when the PLAYING candidate is REJECTED (song_rejected)', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => withQueueContext(c, { playing: true })))
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => emptyContext(c)));

    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    const diffs = await session.applyQueueEvent({ type: 'song_rejected', trackId: 't1' });

    expect(diffs.some((d) => d.event === EVENT.RELEASED)).toBe(true);
    expect(session.getState().state).toBe(STATE.IDLE);
  });

  test('releases locked session when the PLAYING candidate transitions to PLAYED (song_played / queue_updated)', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => withQueueContext(c, { playing: true })))
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => emptyContext(c)));

    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    const diffs = await session.applyQueueEvent({ type: 'queue_updated' });

    expect(diffs.some((d) => d.event === EVENT.RELEASED)).toBe(true);
    expect(session.getState().state).toBe(STATE.IDLE);
  });

  test('after release, audio chunks are accepted again (recognition wakes up)', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => withQueueContext(c, { playing: true })))
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => emptyContext(c)))
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => withQueueContext(c, { approved: true })));

    const ramMatcher = { match: jest.fn(() => [match('t2', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    ramMatcher.match.mockClear();
    expect(ramMatcher.match).not.toHaveBeenCalled();

    await session.applyQueueEvent({ type: 'song_skipped', trackId: 't1' });
    expect(session.getState().state).toBe(STATE.IDLE);

    const diffs = await session.addChunk([{ hash: 2, time: 2 }]);
    expect(ramMatcher.match).toHaveBeenCalledTimes(1);
    expect(diffs.some((d) => d.event === EVENT.HOLD_STARTED || d.event === EVENT.LOCKED)).toBe(true);
  });

  test('proper queue update releases locked PLAYING candidate and wakes recognition for the next phone song', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue({ songId: 'song-t2-approved', trackId: 't2' });
    queueLinker.enrichMatchesWithQueueContext
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => withQueueContext(c, { playing: true })))
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => withQueueContext(c, { approved: true })));

    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    const diffs = await session.applyQueueEvent({ type: 'queue_updated' });

    expect(diffs).toEqual(expect.arrayContaining([expect.objectContaining({
      event: EVENT.RELEASED,
      payload: expect.objectContaining({
        reason: 'queue_target_changed',
        targetTrackId: 't2',
      }),
    })]));
    expect(session.getState().state).toBe(STATE.IDLE);

    ramMatcher.match.mockImplementation(() => [match('t2', 30)]);
    ramMatcher.match.mockClear();
    queueLinker.enrichMatchesWithQueueContext
      .mockImplementationOnce(async (_e, matches) => matches.map((c) => withQueueContext(c, { playing: true })));

    const wakeDiffs = await session.addChunk([{ hash: 2, time: 2 }]);

    expect(ramMatcher.match).toHaveBeenCalledTimes(1);
    expect(session.getState().state).toBe(STATE.LOCKED);
    expect(wakeDiffs.some((d) => d.event === EVENT.LOCKED)).toBe(true);
  });

  test('queue update releases locked PLAYING candidate after its duration elapses', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementationOnce(async (_e, matches) =>
      matches.map((candidate) => {
        const enriched = withQueueContext(candidate, { playing: true });
        return {
          ...enriched,
          duration: 1,
          queueContext: {
            ...enriched.queueContext,
            playing: {
              ...enriched.queueContext.playing,
              totalDuration: 1,
              startedPlayingAt: new Date(Date.now() - 1500).toISOString(),
            },
          },
        };
      }),
    );

    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    const diffs = await session.applyQueueEvent({ type: 'queue_updated' });

    expect(diffs).toEqual(expect.arrayContaining([expect.objectContaining({
      event: EVENT.RELEASED,
      payload: expect.objectContaining({
        reason: 'candidate_duration_elapsed',
      }),
    })]));
    expect(session.getState().state).toBe(STATE.IDLE);
  });
});
