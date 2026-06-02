const unsupportedTransactionError = new Error(
  'Transaction numbers are only allowed on a replica set member or mongos',
);

jest.mock('mongoose', () => ({
  startSession: jest.fn(),
}));

jest.mock('../../src/models/schema', () => ({
  ParticipantModel: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
  UserModel: {
    findById: jest.fn(),
    create: jest.fn(),
  },
}));

jest.mock('../../src/services/auth.service', () => ({
  buildAuthToken: jest.fn(() => 'token'),
}));

jest.mock('../../src/services/participants.service', () => ({
  ensureNicknameIsNotAccessCode: jest.fn(),
  joinEvent: jest.fn(),
}));

jest.mock('../../src/utils', () => ({
  logger: {
    info: jest.fn(),
  },
}));

const mongoose = require('mongoose');
const { ParticipantModel, UserModel } = require('../../src/models/schema');
const authService = require('../../src/services/auth.service');
const participantsService = require('../../src/services/participants.service');
const attendeeSessionService = require('../../src/services/attendee-session.service');

describe('AttendeeSessionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('falls back to a plain join when transactions are unsupported', async () => {
    const session = {
      withTransaction: jest.fn(async () => {
        throw unsupportedTransactionError;
      }),
      endSession: jest.fn(),
    };
    mongoose.startSession.mockResolvedValue(session);

    const existingQuery = {
      select: jest.fn().mockReturnThis(),
      session: jest.fn().mockResolvedValue(null),
    };
    ParticipantModel.findOne.mockReturnValue(existingQuery);
    UserModel.create.mockResolvedValue([
      { _id: 'user-1', email: 'attendee@example.com', displayName: 'Nora', role: 'ATTENDEE' },
    ]);
    participantsService.joinEvent.mockResolvedValue({ _id: 'participant-1' });

    await attendeeSessionService.joinEvent('event-1', 'Nora');

    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(participantsService.joinEvent).toHaveBeenCalledWith(
      'event-1',
      'Nora',
      null,
      undefined,
      'user-1',
      expect.objectContaining({ dbSession: null }),
    );
    expect(authService.buildAuthToken).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'user-1' }),
    );
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
