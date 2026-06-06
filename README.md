<div align="center" style="max-width:320px; margin:0 auto;">
  <a href="https://sr-frontend.onrender.com/" target="_blank" rel="noopener noreferrer">
    <img align="center"
      alt="Syncrequest Logo"
      src="https://github.com/hpedADAITS/HernanPedraza-PI-Front/blob/main/src/assets/logo.png?raw=true"
      style="display:block; width:100%; height:auto;"
    />
  </a>
</div>
&nbsp;
<h1 align="center">Syncrequest Backend</h1>

Non commercial Student proyect Server Backend combining Node.js/Express API, MongoDB data layer, and Socket.IO realtime server for collaborative music-request events.

## Overview

```text
React clients -> Express REST routes -> controllers/services -> Mongoose -> MongoDB
      ^                 |
      `---- Socket.IO event rooms <- domain events
```

REST endpoints handle auth, events, participants, songs, votes, phone microphone tokens (not yet revoked on DJ logout), debug mock accounts, health checks, and Swagger docs. Socket.IO rooms broadcast queue, playback, vote, song, participant, and event updates.

## Main flows

Base REST prefix: `/api/v1`

- Health/API info: `GET /`, `GET /health`, `GET /api/v1`, `GET /api/v1/ping`
- Auth: register/login/logout, `me`, profile picture, email verification.
- Events: create/list/get/update/start/end/cancel/regenerate-code plus public access-code lookup.
- Attendee sessions: join path before authenticated participant flow.
- Participants: nickname validation, join/leave/profile/password/list/admin routes.
- Songs: suggest, queue, pending, approve, reject, skip, send-now, position.
- Votes: cast/remove, stats, participant vote lookup.
- Debug: `POST /debug/mock-accounts` only when `DEBUG_MODE=true` outside production.

Typical event lifecycle: DJ creates/starts an event, shares the access code, attendees join, suggest songs and vote, DJ approves/rejects/controls playback, REST persists changes, Socket.IO updates connected clients.

### DJ auth and event ownership notes

- DJ identity comes from the authenticated JWT/user payload and the event ownership records, with one permission-layer alias: any user with role 'DJ' is treated as full event staff via `isAdmin = role === 'DJ'` (see `Back/src/services/event-permissions.service.js:43`). There is no separate 'admin' role.
- When a DJ creates an event, the backend stores `Event.ownerId` and also creates an `EventMember` row for that user with `role: 'DJ'` and full DJ permissions.
- DJ login loads the DJ's latest own `LIVE` or `DRAFT` event so the frontend keeps the correct Mongo event id and regenerable access code context.
- Old pain point: the login resume path only looked for `LIVE` events while auto-created DJ events were saved as `DRAFT`. That made the app lose the existing event/code context and could cause moderation calls to arrive with stale attendee-like session state.
- Frontend DJ login must reject non-DJ auth responses before creating/loading event state. The stored `user`, `currentEvent`, and `currentParticipant` records should all describe the same authenticated DJ and event id.

## Stack

- Node.js >= 18, Express 4, MongoDB/Mongoose 8, Socket.IO 4
- JWT auth, `bcryptjs`, Helmet, CORS
- Resend email integration
- Swagger via `swagger-jsdoc` and `swagger-ui-express`
- Jest, Supertest, `mongodb-memory-server`, Nodemon

## Structure

```text
src/
  index.js          entrypoint; initializes loaders and HTTP/Socket server
  app.js            configured Express app
  config.js         env-backed configuration
  loaders/          Express, database, Socket.IO, Swagger setup
  routes/           REST registration under /api/v1
  controllers/      HTTP handlers
  services/         domain logic
  models/           Mongoose models/shared schemas
  middleware/       auth, validation, logging, errors
  socket/           auth, rooms, handlers, events, acks
  schemas/  (validators/ and dtos/ are dead code)
  utils/ errors/ constants/
```

## Config

Copy `.env.example` or `env.template` and set local values.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV`, `PORT` | Runtime env and HTTP port. |
| `MONGODB_URI`, `DB_NAME` | MongoDB connection. |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Auth signing and lifetime. Production requires a strong secret. |
| `FRONTEND_URL`, `ALLOWED_ORIGINS`, `SOCKET_CORS_ORIGIN` | REST/socket CORS origins. |
| `LOG_LEVEL`, `LOG_FILE` | Logger config. |
| `RESEND_FROM_EMAIL` | Optional email delivery sender. |
| `DEBUG_MODE`, `SOCKET_AUTH_DISABLED` | Local/debug only; production rejects `DEBUG_MODE=true`. |

## Run

```bash
npm install
npm run dev
npm start
npm test
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:coverage
```

Docker and Render configs are included. Swagger is initialized in `src/loaders/swagger.js`; check that loader for the served docs route.

## Attribution

This project contains a Node.js implementation port of Michael Strauss's "Shazam In Python" Python educational repository and article: https://michaelstrauss.dev/shazam-in-python.
The fingerprinting approach is based on Avery Li-Chun Wang's Shazam paper, "An Industrial-Strength Audio Search Algorithm" (2003).
Additionally the MuisBrainzDB API is used to gather suggestion metadata. https://musicbrainz.org/doc/MusicBrainz_API
