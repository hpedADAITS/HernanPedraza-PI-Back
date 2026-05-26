const mockEventsService = {
  regenerateAccessCode: jest.fn(),
};
const mockSongsService = {
  approveSong: jest.fn(),
  getQueueForEvent: jest.fn(),
  getSongStats: jest.fn(),
};
const mockParticipantsService = {
  getParticipant: jest.fn(),
};
const mockVotesService = {
  castVote: jest.fn(),
};
const mockAuthService = {
  getCurrentUser: jest.fn(),
};

jest.mock('../../src/services', () => ({
  authService: mockAuthService,
  eventsService: mockEventsService,
  participantsService: mockParticipantsService,
  songsService: mockSongsService,
  votesService: mockVotesService,
}));

const eventsController = require('../../src/controllers/events.controller');
const songsController = require('../../src/controllers/songs.controller');
const votesController = require('../../src/controllers/votes.controller');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function createIO() {
  const room = { emit: jest.fn() };
  return {
    room,
    io: {
      to: jest.fn(() => room),
    },
  };
}

describe('REST controller Socket.IO broadcasts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('regenerateAccessCode emits event and access code updates', async () => {
    const { io, room } = createIO();
    const res = createResponse();
    const next = jest.fn();
    const event = {
      id: 'event-1',
      accessCode: 'FRESH1',
    };
    eventsController.setIO(io);
    mockEventsService.regenerateAccessCode.mockResolvedValue(event);

    await eventsController.regenerateAccessCode(
      {
        params: { eventId: 'event-1' },
        user: { userId: 'dj-1' },
      },
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(io.to).toHaveBeenCalledWith('event:event-1');
    expect(room.emit).toHaveBeenCalledWith(
      'event_updated',
      expect.objectContaining({ eventId: 'event-1', event }),
    );
    expect(room.emit).toHaveBeenCalledWith(
      'access_code_updated',
      expect.objectContaining({
        eventId: 'event-1',
        event,
        accessCode: 'FRESH1',
      }),
    );
  });

  test('approveSong emits song_approved and the canonical queue snapshot', async () => {
    const { io, room } = createIO();
    const res = createResponse();
    const next = jest.fn();
    const song = {
      _id: 'song-1',
      title: 'Track',
      artist: 'Artist',
      status: 'APPROVED',
      voteScore: 3,
      voteCount: 3,
    };
    songsController.setIO(io);
    mockSongsService.approveSong.mockResolvedValue(song);
    mockSongsService.getQueueForEvent.mockResolvedValue([song]);

    await songsController.approveSong(
      {
        params: { eventId: 'event-1', songId: 'song-1' },
        user: { userId: 'dj-1' },
      },
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(room.emit).toHaveBeenCalledWith(
      'song_approved',
      expect.objectContaining({
        eventId: 'event-1',
        songId: 'song-1',
        title: 'Track',
      }),
    );
    expect(room.emit).toHaveBeenCalledWith(
      'queue_updated',
      expect.objectContaining({
        eventId: 'event-1',
        queue: [song],
      }),
    );
  });

  test('castVote emits vote and queue updates using the saved song stats', async () => {
    const { io, room } = createIO();
    const res = createResponse();
    const next = jest.fn();
    votesController.setIO(io);
    mockVotesService.castVote.mockResolvedValue({
      id: 'vote-1',
      songId: 'song-1',
      participantId: 'participant-1',
      value: 1,
    });
    mockSongsService.getSongStats.mockResolvedValue({
      _id: 'song-1',
      eventId: 'event-1',
      voteScore: 4,
      voteCount: 6,
    });
    mockSongsService.getQueueForEvent.mockResolvedValue([]);

    await votesController.castVote(
      {
        body: {
          songId: '507f1f77bcf86cd799439011',
          participantId: '507f1f77bcf86cd799439012',
          value: 1,
        },
      },
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(room.emit).toHaveBeenCalledWith(
      'votes_updated',
      expect.objectContaining({
        eventId: 'event-1',
        songId: '507f1f77bcf86cd799439011',
        participantId: '507f1f77bcf86cd799439012',
        value: 1,
        voteScore: 4,
        voteCount: 6,
      }),
    );
    expect(room.emit).toHaveBeenCalledWith(
      'queue_updated',
      expect.objectContaining({ eventId: 'event-1', queue: [] }),
    );
  });
});
