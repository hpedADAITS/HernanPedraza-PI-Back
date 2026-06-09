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
        ? {
            songId: `song-${candidate.trackId}-playing`,
            trackId: candidate.trackId,
            status: 'PLAYING',
            startedPlayingAt: new Date().toISOString(),
            totalDuration: 30,
          }
        : null,
      approvedCount: approved ? 1 : 0,
      isPlayableNow: playing || approved,
      suggestedAction: playing ? 'already_playing' : approved ? 'send_now' : 'no_queue_entry',
    },
  };
}

describe('MatchSession hold mechanism — bug probes', () => {
  beforeEach(() => {
    queueLinker.enrichMatchesWithQueueContext.mockReset();
    queueLinker.findUpNextQueueTrack.mockReset();
    queueLinker.bindRecognitionMatchToPendingSong.mockReset();
  });

  test('HOLDING → LOCKED should fire even when re-evaluate is called without a new chunk', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );

    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 1800, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    // First chunk: starts holding, persistentChunks=1
    const d1 = await session.addChunk([{ hash: 1, time: 1 }]);
    expect(d1.map((d) => d.event)).toContain(EVENT.HOLD_STARTED);
    expect(session.getState().state).toBe(STATE.HOLDING);

    // Backdate holdStartedAt so the hold window has elapsed.
    session.holdStartedAt = Date.now() - 2000;

    // Now re-evaluate: should promote to LOCKED.
    const d2 = await session.reEvaluate();
    expect(d2.map((d) => d.event)).toContain(EVENT.LOCKED);
    expect(session.getState().state).toBe(STATE.LOCKED);
  });

  test('hold does not re-promote to LOCKED via reEvaluate when the hold window has not elapsed', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );

    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 5000, minPersistentChunks: 2, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.HOLDING);

    const d2 = await session.reEvaluate();
    expect(d2).toEqual([]);
    expect(session.getState().state).toBe(STATE.HOLDING);
  });

  test('LOCKED → release happens via applyQueueEvent(song_now_playing) when DJ sends a different track', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );

    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    const diffs = await session.applyQueueEvent({
      type: 'song_now_playing',
      trackId: 't2',
      songId: 'song-t2',
    });
    expect(diffs.map((d) => d.event)).toContain(EVENT.RELEASED);
    expect(diffs[0].payload).toMatchObject({ reason: 'dj_sent_different_track' });
    expect(session.getState().state).toBe(STATE.IDLE);
  });

  test('addChunk drops the candidate when it stops appearing in matches (no_candidate path)', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    let call = 0;
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );

    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        return call === 1 ? [match('t1', 30)] : [];
      }),
    };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 2, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.HOLDING);

    const diffs = await session.addChunk([{ hash: 2, time: 2 }]);
    expect(diffs.map((d) => d.event)).toContain(EVENT.RELEASED);
    expect(session.getState().state).toBe(STATE.IDLE);
  });

  test('swap top match while holding → emits RELEASED with newTopTrackId and starts a new hold', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    let call = 0;
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );

    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        return call === 1 ? [match('t1', 30)] : [match('t2', 40), match('t1', 5)];
      }),
    };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 100, minPersistentChunks: 2, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.HOLDING);

    const diffs = await session.addChunk([{ hash: 2, time: 2 }]);
    expect(diffs.map((d) => d.event)).toEqual(
      expect.arrayContaining([EVENT.RELEASED, EVENT.HOLD_STARTED]),
    );
    const releaseDiff = diffs.find((d) => d.event === EVENT.RELEASED);
    expect(releaseDiff.payload).toMatchObject({
      reason: 'top_match_changed',
      newTopTrackId: 't2',
    });
    expect(session.getState().candidate.trackId).toBe('t2');
  });

  test('applyDjIntent on the locked candidate without a candidate is a no-op', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );
    const ramMatcher = { match: jest.fn(() => []) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });
    const diffs = session.applyDjIntent('t9');
    expect(diffs).toEqual([]);
  });

  test('applyDjIntent on the locked candidate with a matching trackId keeps the lock and emits no diff', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );
    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    const diffs = session.applyDjIntent('t1');
    expect(diffs).toEqual([]);
    expect(session.getState().state).toBe(STATE.LOCKED);
  });

  test('queue_target_changed releases when target trackId differs from candidate (HOLDING)', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue({ songId: 's1', trackId: 'next-track' });
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { approved: true })),
    );
    const ramMatcher = { match: jest.fn(() => [match('current', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 2, minMatchQueryHashes: 1 },
    });
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.HOLDING);

    const diffs = await session.applyQueueEvent({ type: 'queue_updated' });
    expect(diffs.map((d) => d.event)).toContain(EVENT.RELEASED);
    expect(diffs[0].payload).toMatchObject({
      reason: 'queue_target_changed',
      targetTrackId: 'next-track',
    });
  });

  test('warming below minMatchQueryHashes emits CANDIDATE (not HOLD_STARTED) and keeps state IDLE', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );
    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 1800, minPersistentChunks: 2, minMatchQueryHashes: 50 },
    });

    // Add fewer hashes than minMatchQueryHashes — should warm.
    const diffs = await session.addChunk([
      { hash: 1, time: 1 },
      { hash: 2, time: 2 },
    ]);
    expect(diffs.map((d) => d.event)).toEqual([EVENT.CANDIDATE]);
    expect(session.getState().state).toBe(STATE.IDLE);
  });

  test('reset() while HOLDING returns a RELEASED diff with the candidate trackId', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );
    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 100, minPersistentChunks: 2, minMatchQueryHashes: 1 },
    });
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.HOLDING);

    const diffs = session.reset();
    expect(diffs.map((d) => d.event)).toEqual([EVENT.RELEASED]);
    expect(diffs[0].payload).toMatchObject({ trackId: 't1', reason: 'reset' });
    expect(session.getState().state).toBe(STATE.IDLE);
  });

  test('HOLDING → LOCKED via reEvaluate when minPersistentChunks threshold is met but holdWindow has elapsed', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
      matches.map((c) => withQueueContext(c, { playing: true })),
    );

    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = new MatchSession({
      eventId: 'e1',
      ramMatcher,
      options: { holdWindowMs: 500, minPersistentChunks: 2, minMatchQueryHashes: 1 },
    });

    // First chunk: HOLDING, persistentChunks=1
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.HOLDING);

    // Second chunk: still HOLDING, persistentChunks=2, but hold window not elapsed
    await session.addChunk([{ hash: 2, time: 2 }]);
    expect(session.getState().state).toBe(STATE.HOLDING);

    // Backdate holdStartedAt
    session.holdStartedAt = Date.now() - 1000;

    // Re-eval: should now lock
    const diffs = await session.reEvaluate();
    expect(diffs.map((d) => d.event)).toContain(EVENT.LOCKED);
    expect(session.getState().state).toBe(STATE.LOCKED);
  });
});
