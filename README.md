# SyncRekuest Backend

Node.js + Express REST API with real-time Socket.IO and MongoDB persistence.

## Quick Setup

```bash
npm install
npm run dev
```

Server runs on `http://localhost:5000`

## Requirements

- Node.js v18+
- MongoDB (local or MongoDB Atlas)

## Database

Uses MongoDB with Mongoose. Collections auto-created on first connection:

- users
- events
- event_members
- participants
- songs
- votes
- event_action_logs

## API Endpoints

### Auth

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/refresh
GET    /api/auth/me
```

### Events

```
POST   /api/events
GET    /api/events
GET    /api/events/:eventId
PUT    /api/events/:eventId
POST   /api/events/:eventId/close
GET    /api/events/:eventId/participants
```

### Songs

```
POST   /api/songs/suggestions
GET    /api/events/:eventId/queue
GET    /api/events/:eventId/songs/pending
POST   /api/events/:eventId/songs/:songId/approve
POST   /api/events/:eventId/songs/:songId/reject
POST   /api/events/:eventId/songs/:songId/play
POST   /api/events/:eventId/songs/:songId/skip
```

### Votes

```
POST   /api/votes
DELETE /api/votes/:songId
GET    /api/events/:eventId/votes/stats
```

## Socket.IO Events

### From Client

- `join_event` - Join an event
- `leave_event` - Leave an event

### From Server

- `votes_updated` - Vote count changed
- `song_suggested` - New song suggestion
- `song_skipped` - Song skipped by DJ
- `queue_updated` - Queue reordered
- `participant_joined` - User joined
- `participant_left` - User left
- `song_status_changed` - Song status changed

## Project Structure

```
src/
├── index.js                    # Entry point
├── config.js                   # Configuration
├── app.js                      # Express app setup
├── mongo_schema.js             # Mongoose schemas
├── controllers/                # Request handlers
├── services/                   # Business logic
├── routes/                     # API routes
├── socket/                     # Socket.IO handlers
├── middleware/                 # Express middleware
└── utils/                      # Utilities
```

## Running

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

## Testing

```bash
npm test
npm run test:unit
npm run test:integration
```

Creates test users, events, songs, and votes. Test credentials:

- owner@example.com / password123 (DJ)
- dj@example.com / password123 (DJ)
- admin@example.com / password123 (Admin)

## Security

- JWT tokens with 24h expiry
- bcryptjs password hashing (10 rounds)
- Role-based access control (ATTENDEE, DJ, ADMIN)
- CORS restricted to configured origins
- Input validation on all endpoints
- Helmet.js security headers

## Stack

| Component  | Technology       |
| ---------- | ---------------- |
| Runtime    | Node.js v18+     |
| Framework  | Express.js       |
| Database   | MongoDB          |
| Real-time  | Socket.IO        |
| Auth       | JWT + bcryptjs   |
| Validation | mongoose schemas |

## License

MIT
