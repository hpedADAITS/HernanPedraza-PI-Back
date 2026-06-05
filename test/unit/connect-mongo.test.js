/**
 * test/unit/connect-mongo.test.js
 *
 * Regression test for the production case-mismatch error
 *   "db already exists with different case already have: [syncrekuest]
 *    trying to create [Syncrekuest]"
 * raised when MONGODB_URI has a path component (e.g. /syncrekuest) and
 * DB_NAME is set to a different case (e.g. Syncrekuest). The loader now
 * strips the URI path and lowercases dbName, so the two cannot disagree.
 *
 * Two layers of test:
 *   1. stripMongoDbPath is a pure string function — exhaustive table tests.
 *   2. connectMongo round-trips against a real mongodb-memory-server and
 *      pins the actual mongoose.connection.db.databaseName so the case
 *      lowercasing is observable, not just asserted in code.
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  connectMongo,
  stripMongoDbPath,
} = require('../../src/models/schema');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});

describe('stripMongoDbPath', () => {
  test.each([
    [
      'mongodb://localhost:27017/syncrekuest',
      'mongodb://localhost:27017/',
    ],
    [
      'mongodb://localhost:27017/SyncRekuest',
      'mongodb://localhost:27017/',
    ],
    [
      'mongodb://user:pass@localhost:27017/SyncRekuest',
      'mongodb://user:pass@localhost:27017/',
    ],
    [
      'mongodb://host1:27017,host2:27017/SyncRekuest',
      'mongodb://host1:27017,host2:27017/',
    ],
    [
      'mongodb+srv://user@cluster.example.net/SyncRekuest',
      'mongodb+srv://user@cluster.example.net/',
    ],
    [
      'mongodb://localhost:27017/SyncRekuest?retryWrites=true&w=majority',
      'mongodb://localhost:27017/?retryWrites=true&w=majority',
    ],
    [
      'mongodb://localhost:27017/',
      'mongodb://localhost:27017/',
    ],
    [
      'mongodb://localhost:27017',
      'mongodb://localhost:27017',
    ],
  ])('strips path from %s', (input, expected) => {
    expect(stripMongoDbPath(input)).toBe(expected);
  });

  test('returns non-string inputs unchanged', () => {
    expect(stripMongoDbPath(undefined)).toBeUndefined();
    expect(stripMongoDbPath(null)).toBeNull();
    expect(stripMongoDbPath(42)).toBe(42);
  });
});

describe('connectMongo (case-mismatch protection)', () => {
  afterEach(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  });

  test('uses the explicit lowercase dbName, ignoring a Capitalised URI path', async () => {
    const baseUri = mongoServer.getUri();
    /* Inject a Capitalised db path before the trailing slash. */
    const uriWithCapitalPath = baseUri.replace(/\/$/, '/Syncrekuest');

    const connection = await connectMongo(uriWithCapitalPath, 'syncrekuest');

    /* Mongoose 8 exposes the active db name on connection.db. */
    expect(connection.db.databaseName).toBe('syncrekuest');
  });

  test('lowercases dbName so mixed-case env values cannot trigger the case-mismatch error', async () => {
    const baseUri = mongoServer.getUri();

    const connection = await connectMongo(baseUri, 'SyncRekuest');

    expect(connection.db.databaseName).toBe('syncrekuest');
  });

  test('lowercases dbName even when URI has a different-case path (the actual production scenario)', async () => {
    const baseUri = mongoServer.getUri().replace(/\/$/, '/SyncRekuest');

    const connection = await connectMongo(baseUri, 'syncrekuest');

    expect(connection.db.databaseName).toBe('syncrekuest');
  });

  test('falls back to the URI path when dbName is omitted', async () => {
    const baseUri = mongoServer.getUri().replace(/\/$/, '/fallback_db');

    const connection = await connectMongo(baseUri);

    expect(connection.db.databaseName).toBe('fallback_db');
  });

  test('writes land in the explicit dbName, not in the URI path', async () => {
    const baseUri = mongoServer.getUri().replace(/\/$/, '/WrongName');
    const connection = await connectMongo(baseUri, 'right_name');

    /* Create a scratch schema and write a doc. This proves the active
       connection targets the explicit dbName. */
    const Scratch = connection.model(
      'ConnectMongoScratch',
      new mongoose.Schema({ name: String }),
      'scratch',
    );
    await Scratch.create({ name: 'hello' });

    const found = await Scratch.findOne({ name: 'hello' });
    expect(found).toBeTruthy();
    expect(found.name).toBe('hello');
  });
});
