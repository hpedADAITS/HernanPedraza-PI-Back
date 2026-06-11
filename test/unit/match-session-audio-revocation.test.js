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

function withQueueContext(candidate, { playing = false } = {}) {
  return {
    ...candidate,
    queueContext: {
      trackId: candidate.trackId,
      hasMatch: true,
      isInQueue: true,
      hasApproved: false,
      hasPlaying: playing,
      nextApproved: null,
      playing: playing
        ? { songId: `song-${candidate.trackId}-playing`, trackId: candidate.trackId, status: 'PLAYING' }
        : null,
      approvedCount: 0,
      isPlayableNow: playing,
      suggestedAction: playing ? 'already_playing' : 'no_queue_entry',
    },
  };
}

function makeSession(ramMatcher, options = {}) {
  queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) =>
    matches.map((c) => withQueueContext(c)),
  );
  return new MatchSession({
    eventId: 'e1',
    ramMatcher,
    options: {
      holdWindowMs: 0,
      minPersistentChunks: 1,
      minMatchQueryHashes: 1,
      audioRevocationRequiredConfirmations: 2,
      audioRevocationMinElapsedMs: 1500,
      ...options,
    },
  });
}

describe('MatchSession audio revocation — the lock is audio-revocable', () => {
  beforeEach(() => {
    queueLinker.enrichMatchesWithQueueContext.mockReset();
    queueLinker.findUpNextQueueTrack.mockReset();
    queueLinker.bindRecognitionMatchToPendingSong.mockReset();
  });

  test('LOCKED → released and HOLD_STARTED when recent window picks a different track for 2 confirmations and >=1500ms', async () => {
    // First, lock on t1.
    let call = 0;
    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        if (call === 1) return [match('t1', 30)];
        return [match('t2', 30), match('t1', 5)];
      }),
    };
    const session = makeSession(ramMatcher);
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);
    expect(session.getState().candidate.trackId).toBe('t1');

    // Audio switch: each new chunk's match returns t2. We need
    // 2 confirmations spaced at least 1500ms apart to fire the
    // revocation. Each addChunk call uses the same wall clock so we
    // backdate the first-seen timestamp on the revocation candidate
    // to simulate real-time elapsing.
    const diffs1 = await session.addChunk([{ hash: 2, time: 2 }]);
    expect(diffs1).toEqual([]);
    // Hysteresis: 1 confirmation, < 1500ms elapsed. Stay locked.
    expect(session.getState().state).toBe(STATE.LOCKED);

    // Backdate the first-seen to simulate the real-time gap.
    session.audioRevocationCandidate.firstSeenAt = Date.now() - 2000;

    const diffs2 = await session.addChunk([{ hash: 3, time: 3 }]);
    expect(diffs2.map((d) => d.event)).toEqual(
      expect.arrayContaining([EVENT.RELEASED, EVENT.HOLD_STARTED]),
    );
    const releaseDiff = diffs2.find((d) => d.event === EVENT.RELEASED);
    expect(releaseDiff.payload).toMatchObject({
      reason: 'audio_revoked_by_recent_match',
      newTopTrackId: 't2',
    });
    expect(session.getState().state).toBe(STATE.HOLDING);
    expect(session.getState().candidate.trackId).toBe('t2');
  });

  test('LOCKED stays locked when the recent window still favours the locked track', async () => {
    let call = 0;
    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        if (call === 1) return [match('t1', 30)];
        return [match('t1', 40), match('t2', 5)];
      }),
    };
    const session = makeSession(ramMatcher);
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    // Feed several more chunks. The recent window still picks t1.
    for (let i = 0; i < 5; i += 1) {
      const diffs = await session.addChunk([{ hash: 10 + i, time: 10 + i }]);
      expect(diffs).toEqual([]);
    }
    expect(session.getState().state).toBe(STATE.LOCKED);
    expect(session.audioRevocationCandidate).toBeNull();
  });

  test('LOCKED stays locked when the recent window returns no confident winner (silence / sparse audio)', async () => {
    const ramMatcher = {
      match: jest.fn(),
    };
    ramMatcher.match
      .mockReturnValueOnce([match('t1', 30)])
      .mockReturnValue([]); // empty after lock
    const session = makeSession(ramMatcher);
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    for (let i = 0; i < 5; i += 1) {
      const diffs = await session.addChunk([{ hash: 10 + i, time: 10 + i }]);
      expect(diffs).toEqual([]);
    }
    expect(session.getState().state).toBe(STATE.LOCKED);
    expect(session.audioRevocationCandidate).toBeNull();
  });

  test('LOCKED stays locked when only 1 chunk has favoured the new track (hysteresis)', async () => {
    let call = 0;
    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        if (call === 1) return [match('t1', 30)];
        return [match('t2', 30), match('t1', 5)];
      }),
    };
    const session = makeSession(ramMatcher, { audioRevocationRequiredConfirmations: 3 });
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    // First t2 observation creates the revocation candidate.
    await session.addChunk([{ hash: 2, time: 2 }]);
    expect(session.audioRevocationCandidate).not.toBeNull();
    expect(session.audioRevocationCandidate.confirmations).toBe(1);

    // Backdate so the wall-clock floor is satisfied; threshold is
    // 3 confirmations, so we still stay locked after the next chunk.
    session.audioRevocationCandidate.firstSeenAt = Date.now() - 5000;
    const diffs = await session.addChunk([{ hash: 3, time: 3 }]);
    expect(diffs).toEqual([]);
    expect(session.getState().state).toBe(STATE.LOCKED);
    expect(session.audioRevocationCandidate.confirmations).toBe(2);
  });

  test('LOCKED stays locked when the time floor is not met (rapid back-to-back confirmations)', async () => {
    let call = 0;
    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        if (call === 1) return [match('t1', 30)];
        return [match('t2', 30), match('t1', 5)];
      }),
    };
    const session = makeSession(ramMatcher, { audioRevocationMinElapsedMs: 5000 });
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    await session.addChunk([{ hash: 2, time: 2 }]); // 1st confirmation
    await session.addChunk([{ hash: 3, time: 3 }]); // 2nd confirmation, but elapsed < 5000ms
    expect(session.getState().state).toBe(STATE.LOCKED);
  });

  test('Hysteresis counter resets when the competing trackId swaps mid-flight', async () => {
    let call = 0;
    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        if (call === 1) return [match('t1', 30)];
        if (call === 2) return [match('t2', 30), match('t1', 5)];
        if (call === 3) return [match('t3', 30), match('t1', 5)];
        return [match('t2', 30), match('t1', 5)];
      }),
    };
    const session = makeSession(ramMatcher);
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    await session.addChunk([{ hash: 2, time: 2 }]); // t2 first seen
    expect(session.audioRevocationCandidate?.trackId).toBe('t2');
    expect(session.audioRevocationCandidate?.confirmations).toBe(1);

    await session.addChunk([{ hash: 3, time: 3 }]); // t3 takes over — counter resets
    expect(session.audioRevocationCandidate?.trackId).toBe('t3');
    expect(session.audioRevocationCandidate?.confirmations).toBe(1);
    expect(session.getState().state).toBe(STATE.LOCKED);
  });

  test('After audio revocation, accumulatedHashes is seeded with the recent window so the new hold locks fast', async () => {
    let call = 0;
    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        if (call === 1) return [match('t1', 30)];
        return [match('t2', 30), match('t1', 5)];
      }),
    };
    const session = makeSession(ramMatcher);
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    // Second chunk: t2 first seen, still held under threshold.
    await session.addChunk([{ hash: 2, time: 2 }]);

    session.audioRevocationCandidate.firstSeenAt = Date.now() - 2000;
    const diffs = await session.addChunk([{ hash: 3, time: 3 }]);
    expect(diffs.some((d) => d.event === EVENT.HOLD_STARTED)).toBe(true);
    expect(session.getState().state).toBe(STATE.HOLDING);
    // The hold's accumulated buffer should already contain hashes, so
    // the next chunk re-running the standard hold -> lock path is
    // immediate.
    expect(session.accumulatedHashes.length).toBeGreaterThan(0);
  });

  test('reset() while LOCKED clears the recent-hash state so the next session starts clean', async () => {
    let call = 0;
    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        if (call === 1) return [match('t1', 30)];
        return [match('t2', 30), match('t1', 5)];
      }),
    };
    const session = makeSession(ramMatcher);
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    await session.addChunk([{ hash: 2, time: 2 }]);
    expect(session.audioRevocationCandidate).not.toBeNull();
    expect(session.recentHashes.length).toBeGreaterThan(0);

    const diffs = session.reset();
    expect(diffs.map((d) => d.event)).toEqual([EVENT.RELEASED]);
    expect(session.audioRevocationCandidate).toBeNull();
    expect(session.recentHashes).toEqual([]);
    expect(session.accumulatedHashes).toEqual([]);
    expect(session.getState().state).toBe(STATE.IDLE);
  });

  test('audio revocation does not fire on a competing trackId when its margin to the locked track is too low', async () => {
    // The recent window returns t2 with the same score as t1 — the
    // relative margin gate rejects t2 as a confident winner, so the
    // session stays locked.
    const ramMatcher = {
      match: jest.fn(() => {
        // First match: lock on t1.
        // Subsequent matches: t1 and t2 tied.
        const seq = ramMatcher._seq || (ramMatcher._seq = 0);
        ramMatcher._seq = seq + 1;
        if (seq === 0) return [match('t1', 30)];
        return [match('t2', 30), match('t1', 30)];
      }),
    };
    const session = makeSession(ramMatcher);
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);

    for (let i = 0; i < 5; i += 1) {
      const diffs = await session.addChunk([{ hash: 10 + i, time: 10 + i }]);
      expect(diffs).toEqual([]);
    }
    expect(session.getState().state).toBe(STATE.LOCKED);
    expect(session.audioRevocationCandidate).toBeNull();
  });

  test('Audio revocation fires when locked candidate has no queue context (hasPlaying=false)', async () => {
    // Reproduces the original bug: a track recognized-but-UNQUEUED gets
    // locked but the lock can only be released by audio once we wire
    // the recent-window re-match.
    let call = 0;
    const ramMatcher = {
      match: jest.fn(() => {
        call += 1;
        if (call === 1) return [match('t1', 30)];
        return [match('t2', 30), match('t1', 5)];
      }),
    };
    // Override enrichment so the locked candidate has hasPlaying=false.
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_e, matches) => {
      return matches.map((c) => ({
        ...c,
        queueContext: {
          trackId: c.trackId,
          hasMatch: true,
          isInQueue: false,
          hasApproved: false,
          hasPlaying: false,
          nextApproved: null,
          playing: null,
          approvedCount: 0,
          isPlayableNow: false,
          suggestedAction: 'no_queue_entry',
        },
      }));
    });
    const session = makeSession(ramMatcher);
    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe(STATE.LOCKED);
    expect(session.getState().candidate.queueContext.hasPlaying).toBe(false);

    await session.addChunk([{ hash: 2, time: 2 }]);
    session.audioRevocationCandidate.firstSeenAt = Date.now() - 2000;
    const diffs = await session.addChunk([{ hash: 3, time: 3 }]);
    expect(diffs.some((d) => d.event === EVENT.RELEASED)).toBe(true);
    expect(diffs.some((d) => d.event === EVENT.HOLD_STARTED)).toBe(true);
    expect(session.getState().state).toBe(STATE.HOLDING);
    expect(session.getState().candidate.trackId).toBe('t2');
  });

  test('getState() exposes revocation debug fields', () => {
    const ramMatcher = { match: jest.fn(() => [match('t1', 30)]) };
    const session = makeSession(ramMatcher);
    const state = session.getState();
    expect(state).toHaveProperty('recentHashes', 0);
    expect(state).toHaveProperty('audioRevocationCandidate', null);
    expect(state).toHaveProperty('audioRevocationRequiredConfirmations', 2);
    expect(state).toHaveProperty('audioRevocationMinElapsedMs', 1500);
  });
});
