jest.mock('../../src/services/audio-recognition/queue-linker', () => ({
  enrichMatchesWithQueueContext: jest.fn(),
  bindRecognitionMatchToPendingSong: jest.fn(),
  findUpNextQueueTrack: jest.fn(),
}));

const queueLinker = require('../../src/services/audio-recognition/queue-linker');
const { MatchSession, EVENT } = require('../../src/services/audio-recognition/match-session');

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

function withQueueContext(candidate, songId = `song-${candidate.trackId}`) {
  return {
    ...candidate,
    queueContext: {
      trackId: candidate.trackId,
      hasMatch: true,
      isInQueue: true,
      hasApproved: true,
      hasPlaying: false,
      nextApproved: {
        songId,
        trackId: candidate.trackId,
        title: candidate.title,
        artist: candidate.artist,
        status: 'APPROVED',
      },
      approvedCount: 1,
      isPlayableNow: true,
      suggestedAction: 'send_now',
    },
  };
}

describe('MatchSession up-next targeting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_eventId, matches) =>
      matches.map((candidate) => withQueueContext(candidate)),
    );
  });

  test('locks only the up-next queued track, not a stronger unrelated match', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue({
      songId: 'song-target',
      trackId: 'target',
    });
    const ramMatcher = {
      match: jest.fn(() => [match('other', 100), match('target', 20)]),
    };
    const session = new MatchSession({
      eventId: 'event-1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    const diffs = await session.addChunk([{ hash: 1, time: 1 }]);

    expect(diffs.map((diff) => diff.event)).toEqual([
      EVENT.HOLD_STARTED,
      EVENT.LOCKED,
    ]);
    expect(diffs.at(-1).payload.trackId).toBe('target');
  });

  test('pauses while locked and wakes when the queue target changes', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue({
      songId: 'song-target',
      trackId: 'target',
    });
    const ramMatcher = {
      match: jest.fn(() => [match('target', 20)]),
    };
    const session = new MatchSession({
      eventId: 'event-1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    await session.addChunk([{ hash: 1, time: 1 }]);
    expect(session.getState().state).toBe('locked');

    await session.addChunk([{ hash: 2, time: 2 }]);
    expect(ramMatcher.match).toHaveBeenCalledTimes(1);

    queueLinker.findUpNextQueueTrack.mockResolvedValue({
      songId: 'song-next',
      trackId: 'next',
    });
    const diffs = await session.applyQueueEvent({ type: 'queue_updated' });

    expect(diffs[0]).toMatchObject({
      event: EVENT.RELEASED,
      payload: {
        reason: 'queue_target_changed',
        targetTrackId: 'next',
      },
    });
    expect(session.getState().state).toBe('idle');
  });
});
