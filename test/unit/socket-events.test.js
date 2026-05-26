const events = require('../../src/socket/events');

describe('Socket event broadcasts', () => {
  test('join_event includes the participant profile picture', async () => {
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
      eventId: 'event-1',
      participantId: 'participant-1',
      nickname: 'Ada',
      profilePicture: 'avatar-1',
    });

    expect(socket.join).toHaveBeenCalledWith('event:event-1');
    expect(io.to).toHaveBeenCalledWith('event:event-1');
    expect(emit).toHaveBeenCalledWith(
      'participant_joined',
      expect.objectContaining({
        participantId: 'participant-1',
        nickname: 'Ada',
        profilePicture: 'avatar-1',
      }),
    );
  });
});
