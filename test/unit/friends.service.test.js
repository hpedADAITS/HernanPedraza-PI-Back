const { ValidationError, NotFoundError, ForbiddenError } = require('../../src/errors');

/* Mock the schema models that friends.service.js touches. We keep the test
   at the contract level: the service composes the right operations and
   returns the right shape. */
jest.mock('../../src/models/schema', () => {
  const users = new Map();
  const friendships = [];
  const requests = [];
  let requestCounter = 0;

  const fakeObjectId = (value) => {
    if (typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)) return value;
    throw new Error('Bad ObjectId');
  };

  const UserModel = {
    findById: jest.fn((id) => {
      const value = users.get(String(id));
      const chain = {
        select: () => chain,
        lean: () => Promise.resolve(value || null),
      };
      return chain;
    }),
    find: jest.fn((query) => {
      const wanted = new Set((query._id?.$in || []).map((v) => String(v)));
      const matched = [...users.values()].filter((u) => wanted.has(String(u._id)));
      const chain = {
        select: () => chain,
        lean: () => Promise.resolve(matched),
      };
      return chain;
    }),
  };
  UserModel._seed = (user) => users.set(String(user._id), user);
  UserModel._reset = () => users.clear();

  const FriendshipModel = {
    findOne: jest.fn((query) => ({
      lean: () => Promise.resolve(
        friendships.find((row) => (
          String(row.userId) === String(query.userId)
          && String(row.friendId) === String(query.friendId)
        )) || null
      ),
    })),
    updateOne: jest.fn((filter, _update, _options) => {
      const existing = friendships.find((row) => (
        String(row.userId) === String(filter.userId)
        && String(row.friendId) === String(filter.friendId)
      ));
      if (!existing) {
        friendships.push({
          userId: String(filter.userId),
          friendId: String(filter.friendId),
          since: new Date(),
        });
      }
      return Promise.resolve({ upsertedCount: existing ? 0 : 1 });
    }),
    deleteMany: jest.fn((query) => {
      const before = friendships.length;
      const remaining = friendships.filter((row) => {
        const matchesOr = query.$or || [];
        return !matchesOr.some((clause) => (
          String(row.userId) === String(clause.userId)
          && String(row.friendId) === String(clause.friendId)
        ));
      });
      friendships.length = 0;
      friendships.push(...remaining);
      return Promise.resolve({ deletedCount: before - remaining.length });
    }),
  };
  FriendshipModel._list = () => friendships.slice();

  const FriendRequestModel = function (doc) {
    Object.assign(this, doc);
    this._id = `req-${++requestCounter}`;
    this.save = async function save() {
      const idx = requests.findIndex((r) => r._id === this._id);
      if (idx >= 0) requests[idx] = this; else requests.push(this);
      return this;
    };
  };
  FriendRequestModel.findOne = jest.fn((query) => {
    const found = requests.find((r) => (
      String(r.fromUserId) === String(query.fromUserId)
      && String(r.toUserId) === String(query.toUserId)
      && (query.status === undefined || r.status === query.status)
    ));
    return Promise.resolve(found || null);
  });
  FriendRequestModel.findById = jest.fn((id) => {
    const found = requests.find((r) => r._id === id);
    if (!found) return Promise.resolve(null);
    const wrapper = Object.create(FriendRequestModel.prototype);
    Object.assign(wrapper, found);
    wrapper.save = async function save() {
      const idx = requests.findIndex((r) => r._id === this._id);
      if (idx >= 0) requests[idx] = this; else requests.push(this);
      return this;
    };
    return Promise.resolve(wrapper);
  });
  FriendRequestModel.create = jest.fn(async (doc) => {
    const r = new FriendRequestModel(doc);
    requests.push(r);
    return r;
  });
  FriendRequestModel._list = () => requests.slice();
  FriendRequestModel._reset = () => { requests.length = 0; requestCounter = 0; };
  FriendshipModel._reset = () => { friendships.length = 0; };

  const ParticipantModel = {
    findOne: jest.fn((query) => {
      const value = (query._id && query._id.$ne)
        ? null
        : null;
      const chain = {
        sort: () => chain,
        select: () => chain,
        lean: () => Promise.resolve(value),
      };
      return chain;
    }),
  };
  ParticipantModel._set = (value) => { ParticipantModel.findOne = () => ({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(value) }) }) }); };

  const EventModel = {};

  return {
    UserModel,
    FriendRequestModel,
    FriendshipModel,
    EventInviteModel: {},
    ParticipantModel,
    EventModel,
  };
});

const friendsService = require('../../src/services/friends.service');
const { FriendRequestModel, FriendshipModel, UserModel } = require('../../src/models/schema');

const USER_A = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', displayName: 'Alice', profilePicture: null, role: 'DJ', isActive: true, email: 'alice@example.com', emailRegistered: true };
const USER_B = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', displayName: 'Bob',   profilePicture: null, role: 'DJ', isActive: true, email: 'bob@example.com',   emailRegistered: true };
const ANON_USER = { _id: 'cccccccccccccccccccccccc', displayName: 'Anon', profilePicture: null, role: 'ATTENDEE', isActive: true, email: 'attendee_xyz@Syncrequest.local' };

describe('FriendsService', () => {
  beforeEach(() => {
    UserModel._reset();
    FriendRequestModel._reset();
    FriendshipModel._reset();
    UserModel._seed(USER_A);
    UserModel._seed(USER_B);
    UserModel._seed(ANON_USER);
  });

  test('sendFriendRequest creates a pending request', async () => {
    const { request } = await friendsService.sendFriendRequest(
      USER_A._id,
      USER_B._id,
      'hi',
    );
    expect(request.status).toBe('pending');
    expect(request.direction).toBe('outgoing');
    expect(request.other.displayName).toBe('Bob');
  });

  test('rejects self-requests', async () => {
    await expect(
      friendsService.sendFriendRequest(USER_A._id, USER_A._id)
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('rejects requests to anonymous attendees', async () => {
    await expect(
      friendsService.sendFriendRequest(USER_A._id, ANON_USER._id)
    ).rejects.toThrow(/no account/);
  });

  test('accepting a request creates symmetric friendships', async () => {
    const { request } = await friendsService.sendFriendRequest(USER_A._id, USER_B._id);
    const result = await friendsService.respondFriendRequest(request.id, USER_B._id, true);
    expect(result.request.status).toBe('accepted');
    expect(FriendshipModel._list()).toHaveLength(2);
  });

  test('denying a request does not create friendships', async () => {
    const { request } = await friendsService.sendFriendRequest(USER_A._id, USER_B._id);
    const result = await friendsService.respondFriendRequest(request.id, USER_B._id, false);
    expect(result.request.status).toBe('denied');
    expect(FriendshipModel._list()).toHaveLength(0);
  });

  test('reverse direction auto-accepts', async () => {
    await friendsService.sendFriendRequest(USER_A._id, USER_B._id);
    const { request } = await friendsService.sendFriendRequest(USER_B._id, USER_A._id);
    expect(request.status).toBe('accepted');
    expect(FriendshipModel._list()).toHaveLength(2);
  });

  test('unfriend removes both rows', async () => {
    const { request } = await friendsService.sendFriendRequest(USER_A._id, USER_B._id);
    await friendsService.respondFriendRequest(request.id, USER_B._id, true);
    expect(FriendshipModel._list()).toHaveLength(2);
    const result = await friendsService.unfriend(USER_A._id, USER_B._id);
    expect(result.success).toBe(true);
    expect(FriendshipModel._list()).toHaveLength(0);
  });

  test('unfriend on a missing pair throws NotFound', async () => {
    await expect(
      friendsService.unfriend(USER_A._id, USER_B._id)
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
