const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const {
  UserModel,
  EventModel,
  EventMemberModel,
  ParticipantModel,
  SongModel,
  VoteModel,
  EventActionLogModel,
  connectMongo,
  defaultPermissionsForRole,
} = require('../src/models/schema');

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = 'Password1';

const USERS = [
  {
    email: 'admin@Syncrequest.com',
    displayName: 'Admin Principal',
    role: 'ADMIN',
  },
  { email: 'dj.carlos@Syncrequest.com', displayName: 'DJ Carlos', role: 'DJ' },
  { email: 'dj.maria@Syncrequest.com', displayName: 'DJ María', role: 'DJ' },
  { email: 'ana@correo.com', displayName: 'Ana Torres', role: 'ATTENDEE' },
  { email: 'luis@correo.com', displayName: 'Luis García', role: 'ATTENDEE' },
  { email: 'pedro@correo.com', displayName: 'Pedro Ruiz', role: 'ATTENDEE' },
];

const EVENTS = [
  {
    name: 'Noche de Salsa',
    description: 'Noche temática de salsa y bachata',
    accessCode: 'SALSA1',
    state: 'LIVE',
    startsAt: new Date(),
    settings: {
      allowRequests: true,
      requireApproval: false,
      votingEnabled: true,
      allowDownvotes: true,
      maxRequestsPerParticipant: 5,
    },
  },
  {
    name: 'Electro Fest',
    description: 'Festival de música electrónica',
    accessCode: 'ELECT2',
    state: 'DRAFT',
    startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    settings: {
      allowRequests: true,
      requireApproval: true,
      votingEnabled: true,
      allowDownvotes: false,
      maxRequestsPerParticipant: 3,
    },
  },
  {
    name: 'Rock Clásico',
    description: 'Lo mejor del rock de los 80s y 90s',
    accessCode: 'ROCK03',
    state: 'ENDED',
    startsAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    endedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
  },
];

const PARTICIPANT_NAMES = [
  'ChicoFiesta',
  'BailaConmigo',
  'RitmoLoco',
  'NoctámbulaMX',
  'ElMelómano',
  'SalsaQueen',
  'BeatMaster',
  'VibraAlta',
  'LunaRoja',
  'TucanBailable',
  'MixMaestro',
  'EcoNocturno',
];

const SONGS = [
  { title: 'Vivir Mi Vida', artist: 'Marc Anthony' },
  { title: 'Despacito', artist: 'Luis Fonsi' },
  { title: 'La Bicicleta', artist: 'Shakira & Carlos Vives' },
  { title: 'Danza Kuduro', artist: 'Don Omar' },
  { title: 'Bailando', artist: 'Enrique Iglesias' },
  { title: 'Gasolina', artist: 'Daddy Yankee' },
  { title: 'Waka Waka', artist: 'Shakira' },
  { title: 'Suavemente', artist: 'Elvis Crespo' },
  { title: "Livin' on a Prayer", artist: 'Bon Jovi' },
  { title: 'Back in Black', artist: 'AC/DC' },
  { title: 'Bohemian Rhapsody', artist: 'Queen' },
  { title: "Sweet Child O' Mine", artist: "Guns N' Roses" },
];

const SONG_STATUSES = [
  'PENDING',
  'APPROVED',
  'PLAYING',
  'PLAYED',
  'SKIPPED',
  'REJECTED',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN(arr, n) {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

async function populate() {
  await connectMongo(config.mongoUri, config.dbName);
  console.log('Conectado a MongoDB');

  await Promise.all([
    UserModel.deleteMany({}),
    EventModel.deleteMany({}),
    EventMemberModel.deleteMany({}),
    ParticipantModel.deleteMany({}),
    SongModel.deleteMany({}),
    VoteModel.deleteMany({}),
    EventActionLogModel.deleteMany({}),
  ]);
  console.log('Colecciones limpiadas');

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  const users = await UserModel.insertMany(
    USERS.map((u) => ({ ...u, passwordHash, lastLoginAt: new Date() })),
  );
  console.log(`${users.length} usuarios creados`);

  const djUsers = users.filter((u) => u.role === 'DJ');
  const attendeeUsers = users.filter((u) => u.role === 'ATTENDEE');

  const events = [];
  for (const [i, evt] of EVENTS.entries()) {
    const owner = djUsers[i % djUsers.length];
    const created = await EventModel.create({ ...evt, ownerId: owner._id });
    events.push(created);
  }
  console.log(`${events.length} eventos creados`);

  const members = [];
  for (const event of events) {
    const ownerUser = users.find((u) => u._id.equals(event.ownerId));
    members.push(
      await EventMemberModel.create({
        eventId: event._id,
        userId: ownerUser._id,
        role: 'DJ',
        permissions: defaultPermissionsForRole('DJ'),
        addedBy: ownerUser._id,
      }),
    );

    for (const att of attendeeUsers) {
      members.push(
        await EventMemberModel.create({
          eventId: event._id,
          userId: att._id,
          role: 'ATTENDEE',
          permissions: defaultPermissionsForRole('ATTENDEE'),
          addedBy: ownerUser._id,
        }),
      );
    }
  }
  console.log(`${members.length} miembros de evento creados`);

  const allParticipants = [];
  for (const event of events) {
    const names = pickN(PARTICIPANT_NAMES, 6 + Math.floor(Math.random() * 5));
    for (const nickname of names) {
      const p = await ParticipantModel.create({
        eventId: event._id,
        nickname,
        nicknameLower: nickname.toLowerCase(),
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      });
      allParticipants.push({ participant: p, eventId: event._id });
    }
  }
  console.log(`${allParticipants.length} participantes creados`);

  const allSongs = [];
  for (const event of events) {
    const eventParticipants = allParticipants.filter((p) =>
      p.eventId.equals(event._id),
    );
    const songPool = pickN(SONGS, 5 + Math.floor(Math.random() * 4));

    for (const [idx, songData] of songPool.entries()) {
      const requester = pick(eventParticipants).participant;
      const status =
        event.state === 'ENDED'
          ? pick(['PLAYED', 'SKIPPED'])
          : pick(SONG_STATUSES);
      const voteScore = Math.floor(Math.random() * 20) - 5;
      const voteCount = Math.abs(voteScore) + Math.floor(Math.random() * 5);

      const song = await SongModel.create({
        eventId: event._id,
        title: songData.title,
        artist: songData.artist,
        requestedBy: requester._id,
        status,
        voteScore,
        voteCount,
        queuePosition: idx,
        sortKey: `${String(idx).padStart(6, '0')}`,
        pinned: Math.random() < 0.1,
        startedPlayingAt:
          status === 'PLAYING' || status === 'PLAYED' ? new Date() : undefined,
      });
      allSongs.push({ song, eventId: event._id });
    }
  }
  console.log(`${allSongs.length} canciones creadas`);

  let voteCount = 0;
  for (const { song, eventId } of allSongs) {
    const eventParticipants = allParticipants
      .filter((p) => p.eventId.equals(eventId))
      .map((p) => p.participant);

    const voters = pickN(eventParticipants, 2 + Math.floor(Math.random() * 4));
    for (const voter of voters) {
      try {
        await VoteModel.create({
          songId: song._id,
          participantId: voter._id,
          value: Math.random() < 0.7 ? 1 : -1,
        });
        voteCount++;
      } catch {
        /* duplicate vote — skip */
      }
    }
  }
  console.log(`${voteCount} votos creados`);

  const logTypes = [
    'EVENT_START',
    'SONG_APPROVE',
    'SONG_REJECT',
    'PARTICIPANT_KICK',
  ];
  let logCount = 0;
  for (const event of events) {
    const owner = users.find((u) => u._id.equals(event.ownerId));
    const eventSongs = allSongs.filter((s) => s.eventId.equals(event._id));

    for (let i = 0; i < 3; i++) {
      const type = pick(logTypes);
      const log = {
        eventId: event._id,
        actorUserId: owner._id,
        type,
      };
      if (type.startsWith('SONG_') && eventSongs.length) {
        log.songId = pick(eventSongs).song._id;
      }
      await EventActionLogModel.create(log);
      logCount++;
    }
  }
  console.log(`${logCount} action logs creados`);

  const playingSong = allSongs.find((s) => s.song.status === 'PLAYING');
  if (playingSong) {
    await EventModel.findByIdAndUpdate(playingSong.eventId, {
      currentSongId: playingSong.song._id,
    });
    console.log('currentSongId asignado al evento correspondiente');
  }

  console.log('\nPoblación completada.');
  console.log(`Contraseña de todos los usuarios: ${DEFAULT_PASSWORD}`);
  await mongoose.disconnect();
}

populate().catch((err) => {
  console.error('Error durante la población:', err);
  process.exit(1);
});
