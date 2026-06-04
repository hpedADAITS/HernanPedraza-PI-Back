/**
 * Unit tests for songsService.js
 * Tests song suggestion, approval, rejection, queue management, and voting
 */

jest.mock('../../src/models/schema', () => {
  const mockSongInstance = {
    _id: 'song-1',
    save: jest.fn().mockResolvedValue(true),
  };

  // SongModel constructor mock
  const SongModelMock = function(data) {
    return { ...mockSongInstance, ...data };
  };
  SongModelMock.find = jest.fn(() => ({ sort: jest.fn().mockResolvedValue([]), lean: jest.fn().mockResolvedValue([]) }));
  SongModelMock.findById = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) }));
  SongModelMock.findOneAndUpdate = jest.fn();
  SongModelMock.prototype = { validateSync: jest.fn() };

  return {
    SongModel: SongModelMock,
    EventModel: {
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
      findByIdAndUpdate: jest.fn(),
    },
    AudioTrackModel: {
      find: jest.fn(),
    },
  };
});

jest.mock('../../src/services/participants.service', () => ({
  assertParticipantSession: jest.fn(),
}));

jest.mock('../../src/services/event-permissions.service', () => ({
  assertSongAdmin: jest.fn(),
}));

jest.mock('../../src/services/musicbrainz.service', () => ({
  findRecordingMatch: jest.fn(),
}));

jest.mock('../../src/utils', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../../src/utils/song-state-machine', () => ({
  validateTransition: jest.fn(),
}));

const { SongModel, EventModel, AudioTrackModel } = require('../../src/models/schema');
const participantsService = require('../../src/services/participants.service');
const eventPermissionsService = require('../../src/services/event-permissions.service');
const musicBrainzService = require('../../src/services/musicbrainz.service');
const songsService = require('../../src/services/songs.service');

describe('SongsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('suggestSong', () => {
    const mockSongData = {
      _id: 'song-id-1',
      title: 'Test Song',
      artist: 'Test Artist',
      eventId: 'event-id-1',
      requestedBy: 'participant-id-1',
      status: 'PENDING',
      sortKey: '1234567890_test-key',
      totalDuration: 180,
      save: jest.fn().mockResolvedValue(true),
    };

    test('should create a new song', async () => {
      participantsService.assertParticipantSession.mockResolvedValue({});
      
      const mockSongInstance = { ...mockSongData };
      SongModel.mockImplementation(() => mockSongInstance);

      const result = await songsService.suggestSong(
        'event-id-1',
        'participant-id-1',
        'Test Song',
        'Test Artist',
        180,
        { userId: 'user-1', role: 'DJ' }
      );

      expect(participantsService.assertParticipantSession).toHaveBeenCalledWith(
        'participant-id-1',
        'event-id-1',
        { userId: 'user-1', role: 'DJ' },
        { checkCooldown: true }
      );
    });

    test('should use recognition match duration when totalDuration is invalid', async () => {
      participantsService.assertParticipantSession.mockResolvedValue({});
      musicBrainzService.findRecordingMatch.mockResolvedValue({
        duration: 200,
        title: 'Test Song',
        artist: 'Test Artist',
      });

      const mockSongInstance = {
        ...mockSongData,
        recognitionMatch: { duration: 200 },
      };
      SongModel.mockImplementation(() => mockSongInstance);

      const result = await songsService.suggestSong(
        'event-id-1',
        'participant-id-1',
        'Test Song',
        'Test Artist',
        null,
        { userId: 'user-1', role: 'DJ' }
      );

      expect(result).toBeDefined();
    });
  });

  describe('getQueueForEvent', () => {
    test('should return sorted queue with positions', async () => {
      const mockSongs = [
        { _id: 'song-1', title: 'Song A', status: 'APPROVED', voteScore: 5, pinned: false, sortKey: '1' },
        { _id: 'song-2', title: 'Song B', status: 'PLAYING', voteScore: 3, pinned: true, sortKey: '2' },
        { _id: 'song-3', title: 'Song C', status: 'APPROVED', voteScore: 3, pinned: false, sortKey: '3' },
      ];

      SongModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(mockSongs),
      });

      const result = await songsService.getQueueForEvent('event-id-1');

      expect(SongModel.find).toHaveBeenCalledWith({
        eventId: 'event-id-1',
        status: { $in: ['APPROVED', 'PLAYING'] },
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    test('should return empty array when no songs in queue', async () => {
      SongModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue([]),
      });

      const result = await songsService.getQueueForEvent('event-id-1');

      expect(result).toEqual([]);
    });
  });

  describe('getPendingSongsForEvent', () => {
    test('should return pending songs', async () => {
      const mockSongs = [
        { _id: 'song-1', title: 'Pending 1', status: 'PENDING' },
        { _id: 'song-2', title: 'Pending 2', status: 'PENDING' },
      ];

      SongModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockResolvedValue(mockSongs),
      });

      const result = await songsService.getPendingSongsForEvent('event-id-1');

      expect(SongModel.find).toHaveBeenCalledWith({
        eventId: 'event-id-1',
        status: 'PENDING',
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('approveSong', () => {
    test('should approve a pending song', async () => {
      eventPermissionsService.assertSongAdmin.mockResolvedValue();
      
      const mockSong = {
        _id: 'song-id-1',
        eventId: { toString: () => 'event-id-1' },
        status: 'PENDING',
        recognitionMatch: null,
        save: jest.fn().mockResolvedValue(true),
      };

      SongModel.findById.mockResolvedValue(mockSong);
      songsService._formatSong = jest.fn().mockReturnValue({ _id: 'song-id-1', status: 'APPROVED' });

      const result = await songsService.approveSong('song-id-1', 'event-id-1', 'user-1');

      expect(eventPermissionsService.assertSongAdmin).toHaveBeenCalledWith('event-id-1', 'user-1');
      expect(mockSong.status).toBe('APPROVED');
      expect(mockSong.save).toHaveBeenCalled();
    });

    test('should throw NotFoundError when song not found', async () => {
      SongModel.findById.mockResolvedValue(null);

      await expect(songsService.approveSong('invalid-id', 'event-id-1', 'user-1'))
        .rejects.toThrow('Song not found');
    });

    test('should throw NotFoundError when song belongs to different event', async () => {
      const mockSong = {
        _id: 'song-id-1',
        eventId: { toString: () => 'other-event-id' },
        status: 'PENDING',
      };

      SongModel.findById.mockResolvedValue(mockSong);

      await expect(songsService.approveSong('song-id-1', 'event-id-1', 'user-1'))
        .rejects.toThrow('Song not in this event');
    });
  });

  describe('rejectSong', () => {
    test('should reject a song with reason', async () => {
      eventPermissionsService.assertSongAdmin.mockResolvedValue();

      const mockSong = {
        _id: 'song-id-1',
        eventId: { toString: () => 'event-id-1' },
        status: 'PENDING',
        save: jest.fn().mockResolvedValue(true),
      };

      SongModel.findById.mockResolvedValue(mockSong);
      songsService._formatSong = jest.fn().mockReturnValue({ _id: 'song-id-1', status: 'REJECTED' });

      const result = await songsService.rejectSong('song-id-1', 'event-id-1', 'Inappropriate', 'user-1');

      expect(mockSong.status).toBe('REJECTED');
      expect(mockSong.save).toHaveBeenCalled();
    });
  });

  describe('sendNow', () => {
    test('should mark song as playing and update event', async () => {
      eventPermissionsService.assertSongAdmin.mockResolvedValue();

      const mockSong = {
        _id: 'song-id-1',
        eventId: { toString: () => 'event-id-1' },
        status: 'APPROVED',
        startedPlayingAt: null,
        save: jest.fn().mockResolvedValue(true),
      };

      const mockEventUpdate = jest.fn();
      EventModel.findByIdAndUpdate.mockReturnValue(mockEventUpdate);

      SongModel.findById.mockResolvedValue(mockSong);
      SongModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      
      songsService._formatSong = jest.fn().mockReturnValue({ _id: 'song-id-1', status: 'PLAYING' });

      const result = await songsService.sendNow('song-id-1', 'event-id-1', 'user-1');

      expect(mockSong.status).toBe('PLAYING');
      expect(EventModel.findByIdAndUpdate).toHaveBeenCalledWith('event-id-1', {
        currentSongId: mockSong._id,
      });
    });

    test('should clear other PLAYING songs when sending new song', async () => {
      eventPermissionsService.assertSongAdmin.mockResolvedValue();

      const mockSong = {
        _id: 'song-id-2',
        eventId: { toString: () => 'event-id-1' },
        status: 'APPROVED',
        save: jest.fn().mockResolvedValue(true),
      };

      SongModel.findById.mockResolvedValue(mockSong);
      SongModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
      
      songsService._formatSong = jest.fn().mockReturnValue({ _id: 'song-id-2', status: 'PLAYING' });

      await songsService.sendNow('song-id-2', 'event-id-1', 'user-1');

      expect(SongModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'event-id-1',
          status: 'PLAYING',
        }),
        { status: 'PLAYED' }
      );
    });
  });

  describe('playNextSong', () => {
    test('should play next approved song in queue', async () => {
      eventPermissionsService.assertSongAdmin.mockResolvedValue();

      const nextSong = {
        _id: 'song-next',
        eventId: 'event-id-1',
        status: 'PLAYING',
        save: jest.fn().mockResolvedValue(true),
      };

      SongModel.findOneAndUpdate.mockResolvedValue(nextSong);
      songsService._formatSong = jest.fn().mockReturnValue({ _id: 'song-next', status: 'PLAYING' });

      const result = await songsService.playNextSong('event-id-1', 'user-1');

      expect(result).toBeDefined();
      expect(result.status).toBe('PLAYING');
    });

    test('should return null when no approved songs remain', async () => {
      eventPermissionsService.assertSongAdmin.mockResolvedValue();
      SongModel.findOneAndUpdate.mockResolvedValue(null);

      const result = await songsService.playNextSong('event-id-1', 'user-1');

      expect(result).toBeNull();
    });
  });

  describe('getSongPosition', () => {
    test('should return position in queue', async () => {
      const mockSong = {
        _id: 'song-1',
        eventId: 'event-id-1',
        status: 'APPROVED',
        voteScore: 5,
      };

      const mockQueue = [
        { _id: 'song-1', queuePosition: 1 },
        { _id: 'song-2', queuePosition: 2 },
      ];

      SongModel.findById.mockResolvedValue(mockSong);
      songsService.getQueueForEvent = jest.fn().mockResolvedValue(mockQueue);

      const result = await songsService.getSongPosition('song-1');

      expect(result.position).toBe(1);
    });

    test('should return null position when song not in queue', async () => {
      const mockSong = {
        _id: 'not-in-queue',
        eventId: 'event-id-1',
      };

      const mockQueue = [{ _id: 'song-1' }];

      SongModel.findById.mockResolvedValue(mockSong);
      songsService.getQueueForEvent = jest.fn().mockResolvedValue(mockQueue);

      const result = await songsService.getSongPosition('not-in-queue');

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
      const mockQueue = [{ _id: 'song-1', status: 'PLAYING' }];
      songsService.getQueueForEvent = jest.fn().mockResolvedValue(mockQueue);

      const result = await songsService.getQueueSnapshotForEvent('event-id-1');

      expect(result.queue).toEqual(mockQueue);
      expect(result.nowPlaying).toBeDefined();
    });

    test('should return null nowPlaying when nothing is playing', async () => {
      const mockQueue = [{ _id: 'song-1', status: 'APPROVED' }];
      songsService.getQueueForEvent = jest.fn().mockResolvedValue(mockQueue);

      const result = await songsService.getQueueSnapshotForEvent('event-id-1');

      expect(result.nowPlaying).toBeNull();
    });
  });
});