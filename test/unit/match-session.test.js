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

function withQueueContext(candidate, songId = `song-${candidate.trackId}`, status = 'APPROVED') {
  const isPlaying = status === 'PLAYING';
  return {
    ...candidate,
    queueContext: {
      trackId: candidate.trackId,
      hasMatch: true,
      isInQueue: true,
      hasApproved: !isPlaying,
      hasPlaying: isPlaying,
      nextApproved: isPlaying ? null : {
        songId,
        trackId: candidate.trackId,
        title: candidate.title,
        artist: candidate.artist,
        status: 'APPROVED',
      },
      playing: isPlaying ? {
        songId,
        trackId: candidate.trackId,
        title: candidate.title,
        artist: candidate.artist,
        status: 'PLAYING',
      } : null,
      approvedCount: isPlaying ? 0 : 1,
      isPlayableNow: true,
      suggestedAction: isPlaying ? 'already_playing' : 'send_now',
    },
  };
}

describe('MatchSession microphone recognition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_eventId, matches) =>
      matches.map((candidate) => withQueueContext(candidate)),
    );
  });

  test('locks the strongest microphone match instead of forcing the up-next track', async () => {
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
    expect(diffs.at(-1).payload.trackId).toBe('other');
  });

  test('locks a playing microphone match without an approved up-next target', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    queueLinker.enrichMatchesWithQueueContext.mockImplementation(async (_eventId, matches) =>
      matches.map((candidate) => withQueueContext(candidate, `song-${candidate.trackId}`, 'PLAYING')),
    );
    const ramMatcher = {
      match: jest.fn(() => [match('playing', 30)]),
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
    expect(diffs.at(-1).payload).toMatchObject({
      trackId: 'playing',
      queueContext: {
        hasPlaying: true,
        suggestedAction: 'already_playing',
      },
    });
  });

  test('does not hold a low-confidence microphone candidate', async () => {
    queueLinker.findUpNextQueueTrack.mockResolvedValue(null);
    const ramMatcher = {
      match: jest.fn(() => [{
        ...match('noisy', 8),
        totalAligned: 40,
        offsetConcentration: 0.2,
      }]),
    };
    const session = new MatchSession({
      eventId: 'event-1',
      ramMatcher,
      options: { holdWindowMs: 0, minPersistentChunks: 1, minMatchQueryHashes: 1 },
    });

    const diffs = await session.addChunk([{ hash: 1, time: 1 }]);

    expect(diffs).toEqual([]);
    expect(session.getState().state).toBe('idle');
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
