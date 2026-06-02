const events = require('../../src/socket/events');
const { Types } = require('mongoose');

describe('Socket event broadcasts', () => {
  const originalSocketAuthDisabled = process.env.SOCKET_AUTH_DISABLED;

  beforeEach(() => {
    process.env.SOCKET_AUTH_DISABLED = 'true';
  });

  afterEach(() => {
    if (originalSocketAuthDisabled === undefined) {
      delete process.env.SOCKET_AUTH_DISABLED;
    } else {
      process.env.SOCKET_AUTH_DISABLED = originalSocketAuthDisabled;
    }
  });

  test('join_event includes the participant profile picture', async () => {
    const eventId = new Types.ObjectId().toString();
    const participantId = new Types.ObjectId().toString();
    const socket = {
      id: 'socket-1',
      join: jest.fn(),
      emit: jest.fn(),
      rooms: new Set(),
    };
    const emit = jest.fn();
    const io = {
      to: jest.fn(() => ({ emit })),
    };

    await events.handleJoinEvent(socket, io, {
      eventId,
      participantId,
      nickname: 'Ada',
      profilePicture: 'avatar-1',
    });

    expect(socket.join).toHaveBeenCalledWith(`event:${eventId}`);
    expect(io.to).toHaveBeenCalledWith(`event:${eventId}`);
    expect(emit).toHaveBeenCalledWith(
      'participant_joined',
      expect.objectContaining({
        participantId,
        nickname: 'Ada',
        profilePicture: 'avatar-1',
      }),
    );
  });
});
