/**
 * Unit tests for socket/room.js — focused on the phone-microphone
 * disconnect broadcast path. The phone socket never joins the event
 * room, so the disconnect handler must use the server-side `io` to
 * notify the rest of the event that the audio source dropped.
 */

const { handleDisconnect } = require('../../src/socket/room');

describe('socket/room.handleDisconnect — phone microphone', () => {
  function makeIO() {
    const emitted = [];
    const io = {
      to: jest.fn((room) => ({
        emit: jest.fn((event, payload) => {
          emitted.push({ room, event, payload });
        }),
      })),
    };
    return { io, emitted };
  }

  test('broadcasts phone_microphone_disconnected to the event room', () => {
    const { io, emitted } = makeIO();
    const socket = {
      id: 'phone-socket-1',
      user: {
        type: 'phone-microphone',
        eventId: 'event-42',
      },
    };

    handleDisconnect(socket, io);

    expect(io.to).toHaveBeenCalledWith('event:event-42');
    expect(emitted).toEqual([
      {
        room: 'event:event-42',
        event: 'phone_microphone_disconnected',
        payload: expect.objectContaining({
          eventId: 'event-42',
          timestamp: expect.any(String),
        }),
      },
    ]);
  });

  test('does not emit when the disconnecting socket is not a phone microphone', () => {
    const { io, emitted } = makeIO();
    const socket = {
      id: 'attendee-socket-1',
      user: { type: 'attendee', userId: 'user-1' },
      eventId: 'event-1',
      participantId: 'participant-1',
      isEventStaff: false,
    };

    handleDisconnect(socket, io);

    const phoneDisconnects = emitted.filter(
      (entry) => entry.event === 'phone_microphone_disconnected',
    );
    expect(phoneDisconnects).toHaveLength(0);
  });

  test('does not emit when the phone microphone socket is missing its eventId', () => {
    const { io, emitted } = makeIO();
    const socket = {
      id: 'phone-socket-2',
      user: { type: 'phone-microphone' },
    };

    handleDisconnect(socket, io);

    const phoneDisconnects = emitted.filter(
      (entry) => entry.event === 'phone_microphone_disconnected',
    );
    expect(phoneDisconnects).toHaveLength(0);
  });
});
