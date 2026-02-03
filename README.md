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

## Configuration

Create `.env` file (template in `env.template`):

```
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/syncrekuest
JWT_SECRET=your-secret-key-change-in-production
FRONTEND_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
SOCKET_CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info
LOG_FILE=logs/app.log
```

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

## Database Population (Development Only)

Optional test data seeding script in `scripts/populate_db.js`:

```bash
node scripts/populate_db.js
```

Creates test users, events, songs, and votes. Test credentials:
- owner@example.com / password123 (DJ)
- dj@example.com / password123 (DJ)
- admin@example.com / password123 (Admin)

## Deployment

For deployment to Render with MongoDB Atlas, see `RENDER_DEPLOYMENT_GUIDE.md` in project root.

## Error Responses

All errors follow this format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  },
  "statusCode": 400
}
```

## Security

- JWT tokens with 24h expiry
- bcryptjs password hashing (10 rounds)
- Role-based access control (ATTENDEE, DJ, ADMIN)
- CORS restricted to configured origins
- Input validation on all endpoints
- Helmet.js security headers

## Troubleshooting

**MongoDB connection fails**
- Check MONGODB_URI format
- For Atlas: Verify IP whitelist
- Test with: `mongosh "mongodb://..."`

**JWT errors**
- Verify JWT_SECRET matches frontend
- Check Authorization header format: `Bearer <token>`

**Socket.IO connection fails**
- Check SOCKET_CORS_ORIGIN
- Verify frontend URL matches

**Port already in use**
- Change PORT in .env
- Or kill existing process: `lsof -i :5000`

## Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js v18+ |
| Framework | Express.js |
| Database | MongoDB |
| Real-time | Socket.IO |
| Auth | JWT + bcryptjs |
| Validation | mongoose schemas |

## License

MIT
