<p align="center">
  <img src="docs/logo.png" alt="SyncRekuest logo" width="180" />
</p>

<h1 align="center">SyncRekuest Backend</h1>

<p align="center">
  Node.js API, MongoDB data layer, and Socket.IO realtime server for collaborative music-request events.
</p>

<p align="center">
  <strong>Node.js</strong> · <strong>Express</strong> · <strong>MongoDB</strong> · <strong>Mongoose</strong> · <strong>Socket.IO</strong> · <strong>JWT</strong> · <strong>Jest</strong>
</p>

Backend API for SyncRekuest, a real-time collaborative music request and voting platform. DJs create live events, attendees join with an access code, suggest songs, vote on the queue, and receive live queue/status updates over Socket.IO.

## How it works

```text
React clients ─► Express REST routes ─► controllers/services ─► Mongoose ─► MongoDB
      ▲                    │
      └──── Socket.IO rooms ◄──── domain events after queue/song/participant changes
```

REST endpoints handle authentication, event management, participant actions, songs, and votes. Socket.IO rooms mirror the same event lifecycle so connected DJs and attendees see queue and playback changes immediately.

## What it does

- Authenticates users with JWTs and stores accounts in MongoDB.
- Lets DJs create, start, update, end, cancel, and manage music events.
- Supports attendee joining by event access code and nickname.
- Manages participants, including profile updates, premium flags, cooldowns, kicks, and bans.
- Accepts song suggestions, approval/rejection, queue reads, skip/send-now operations, and vote tracking.
- Broadcasts realtime event, participant, vote, song, and queue changes through Socket.IO event rooms.
- Exposes Swagger/OpenAPI documentation and health endpoints.
- Provides local-only debug mock-account creation when `DEBUG_MODE=true` and not in production.

## Key API and domain flows

Base REST prefix: `/api/v1`

- **Health/API info**: `GET /`, `GET /health`, `GET /api/v1`, `GET /api/v1/ping`
- **Auth**: `POST /auth/register`, `POST /auth/login`, protected `POST /auth/logout`, `GET/PATCH /auth/me`, profile picture and email verification endpoints.
- **Events**:
  - Public attendee lookup: `GET /events/access/:accessCode`
  - Protected DJ/event operations: create/list/get/update plus `/:eventId/start`, `end`, `cancel`, `regenerate-code`
  - Phone microphone support: signed link generation and token-protected phone connection endpoints
- **Attendee session**: `POST /attendee-session/events/:eventId/join` creates the attendee session path used before a normal authenticated participant flow.
- **Participants**: public nickname validation, then protected join/leave/profile/password/list/admin management routes.
- **Songs**: protected suggest, queue, pending, approve, reject, skip, send-now, and position routes.
- **Votes**: protected cast/remove vote and vote stats/participant vote lookup.
- **Debug**: `POST /debug/mock-accounts` only when `DEBUG_MODE=true` outside production.

Typical flow:

1. DJ registers/logs in and creates an event.
2. DJ starts the event and shares its access code/QR link.
3. Attendee looks up the event by access code, validates nickname, and joins.
4. Attendee suggests songs and casts up/down votes.
5. DJ approves/rejects pending songs and controls playback state.
6. REST mutations persist to MongoDB and Socket.IO broadcasts update connected clients in the event room.

## Stack

- Node.js >= 18
- Express 4
- MongoDB with Mongoose 8
- Socket.IO 4 for realtime updates
- JWT authentication (`jsonwebtoken`)
- Password hashing with `bcryptjs`
- Helmet and CORS middleware
- Swagger docs via `swagger-jsdoc` and `swagger-ui-express`
- Resend email service integration
- Jest, Supertest, and mongodb-memory-server for tests
- Nodemon for local development

## Project structure

```text
Back/
├── src/
│   ├── index.js              # process entrypoint; initializes loaders and HTTP/Socket server
│   ├── app.js                # exports configured Express app
│   ├── config.js             # environment-backed app configuration
│   ├── loaders/              # Express, database, Socket.IO, Swagger setup
│   ├── routes/               # REST route registration under /api/v1
│   ├── controllers/          # HTTP request handlers
│   ├── services/             # business/domain logic
│   ├── models/               # Mongoose models and shared schema definitions
│   ├── middleware/           # auth, validation, logging, error handling
│   ├── socket/               # Socket.IO auth, rooms, handlers, events, acks
│   ├── validators/ schemas/ dtos/ # request validation and response shaping helpers
│   ├── utils/                # JWT, logging, code generation, cooldown, song state machine
│   ├── errors/               # API error classes
│   └── constants/            # HTTP/status/domain constants
├── scripts/populate.js       # seed/populate script
├── test/                     # Jest tests
├── Dockerfile
├── docker-compose.yml
├── render.yaml
└── package.json
```

## Environment and configuration

Configuration is read in `src/config.js` using `dotenv`. Copy `.env.example` or `env.template` to a local env file and adjust values for your environment.

Common variables:

| Variable | Purpose | Default / note |
| --- | --- | --- |
| `NODE_ENV` | Runtime environment | `development` |
| `PORT` | HTTP port | `5000` |
| `MONGODB_URI` | MongoDB connection URI | `mongodb://localhost:27017/syncrekuest` |
| `DB_NAME` | Database name | `syncrekuest` |
| `JWT_SECRET` | JWT signing secret | local fallback only outside production; required in production and must be >= 32 chars |
| `JWT_EXPIRES_IN` | JWT lifetime | `24h` |
| `FRONTEND_URL` | Main frontend URL | `http://localhost:5173` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | localhost frontend origins |
| `SOCKET_CORS_ORIGIN` | Socket.IO CORS origin | `http://localhost:5173` |
| `LOG_LEVEL` / `LOG_FILE` | Logger configuration | `info`, `logs/app.log` |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Email service config | needed for real email delivery |
| `DEBUG_MODE` | Enables local debug-only features | must not be true in production |
| `SOCKET_AUTH_DISABLED` | Optional local Socket.IO auth bypass | intended for local/debug use only |

Production safety notes:

- `DEBUG_MODE=true` is rejected when `NODE_ENV=production`.
- `JWT_SECRET` is mandatory in production and must be strong enough.
- Keep debug routes and auth bypass options disabled outside local development.

## Install and run

From this folder:

```bash
npm install
npm run dev
```

For a normal Node start:

```bash
npm start
```

Useful commands:

```bash
npm run seed              # populate sample data
npm test                  # all Jest tests
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage
```

Docker files are present for containerized deployment, and `render.yaml` contains Render deployment configuration.

## API documentation

Swagger/OpenAPI is initialized by `src/loaders/swagger.js`. When the server is running, check the configured Swagger UI route in that loader for interactive API docs.
