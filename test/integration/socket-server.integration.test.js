process.env.SOCKET_AUTH_DISABLED = 'true';

const app = require('../../src/app');
const { initSocketIO } = require('../../src/loaders/socket');
const { io: Client } = require('../../../Front/node_modules/socket.io-client');

function waitForEvent(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const onEvent = (data) => {
      clearTimeout(timer);
      resolve(data);
    };

    socket.once(event, onEvent);
  });
}

describe('Socket.IO server integration', () => {
  let io;
  let httpServer;
  let serverUrl;
  let clients = [];

  beforeAll(async () => {
    ({ io, httpServer } = initSocketIO(app));
    await new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = httpServer.address();
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    clients = [];
  });

  afterEach(() => {
    clients.forEach((client) => {
      if (client.connected) {
        client.disconnect();
      }
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => {
      io.close(resolve);
    });
    delete process.env.SOCKET_AUTH_DISABLED;
  });

  async function connectClient() {
    const client = Client(serverUrl, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    clients.push(client);
    await waitForEvent(client, 'connect');
    return client;
  }

  test('broadcasts join_event to another client in the event room', async () => {
    const broadcaster = await connectClient();
    const listener = await connectClient();

    const listenerJoined = waitForEvent(listener, 'participant_joined');
    listener.emit('join_event', {
      eventId: 'event-real-1',
      participantId: 'participant-listener',
      nickname: 'Listener',
    });
    await listenerJoined;

    const broadcastReceived = waitForEvent(listener, 'participant_joined');
    broadcaster.emit('join_event', {
      eventId: 'event-real-1',
      participantId: 'participant-broadcaster',
      nickname: 'Broadcaster',
    });

    await expect(broadcastReceived).resolves.toEqual(
      expect.objectContaining({
        participantId: 'participant-broadcaster',
        nickname: 'Broadcaster',
        joinedAt: expect.any(String),
      }),
    );
  });

  test('emits a real socket error for invalid join_event payloads', async () => {
    const client = await connectClient();

    const errorReceived = waitForEvent(client, 'error');
    client.emit('join_event', {
      eventId: 'event-real-1',
    });

    await expect(errorReceived).resolves.toEqual({
      message: 'Invalid event or participant ID',
    });
  });
});
