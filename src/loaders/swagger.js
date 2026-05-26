const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const config = require('../config');

const swaggerDefinition = {
  openapi: '3.0.3',
  info: {
    title: 'SyncRekuest API',
    version: '1.0.0',
    description:
      'Real-time collaborative music voting platform API. DJs create events, attendees join via access codes, suggest songs, and vote on the queue.',
    contact: { name: 'Hernan Pedraza' },
    license: { name: 'MIT' },
  },
  servers: [
    {
      url: `http://localhost:${config.port}/api/v1`,
      description: 'Local development',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          _id: { type: 'string', example: '665a1b2c3d4e5f6a7b8c9d0e' },
          email: { type: 'string', format: 'email', example: 'dj@example.com' },
          displayName: { type: 'string', example: 'DJ Mike' },
          role: { type: 'string', enum: ['ATTENDEE', 'DJ', 'ADMIN'] },
          isActive: { type: 'boolean' },
          lastLoginAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthResult: {
        type: 'object',
        properties: {
          user: { $ref: '#/components/schemas/User' },
          token: { type: 'string' },
        },
      },
      EventSettings: {
        type: 'object',
        properties: {
          allowRequests: { type: 'boolean', default: true },
          requireApproval: { type: 'boolean', default: false },
          votingEnabled: { type: 'boolean', default: true },
          allowDownvotes: { type: 'boolean', default: true },
          maxRequestsPerParticipant: {
            type: 'integer',
            default: 3,
            minimum: 0,
          },
        },
      },
      Event: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string', example: 'Friday Night Party' },
          description: { type: 'string' },
          ownerId: { type: 'string' },
          accessCode: { type: 'string', example: 'XK9R2' },
          qrCodeUrl: { type: 'string' },
          state: {
            type: 'string',
            enum: ['DRAFT', 'LIVE', 'ENDED', 'CANCELLED'],
          },
          startsAt: { type: 'string', format: 'date-time' },
          endedAt: { type: 'string', format: 'date-time' },
          cancelledAt: { type: 'string', format: 'date-time' },
          cancelledReason: { type: 'string' },
          currentSongId: { type: 'string' },
          settings: { $ref: '#/components/schemas/EventSettings' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Participant: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          eventId: { type: 'string' },
          nickname: { type: 'string', example: 'PartyGoer42' },
          joinedAt: { type: 'string', format: 'date-time' },
          lastSeenAt: { type: 'string', format: 'date-time' },
          isBanned: { type: 'boolean' },
          isPremium: { type: 'boolean' },
          cooldownUntil: { type: 'string', format: 'date-time' },
          cooldownReason: { type: 'string' },
          leftAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Song: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          eventId: { type: 'string' },
          title: { type: 'string', example: 'Bohemian Rhapsody' },
          artist: { type: 'string', example: 'Queen' },
          requestedBy: { type: 'string' },
          status: {
            type: 'string',
            enum: [
              'PENDING',
              'APPROVED',
              'PLAYING',
              'PLAYED',
              'SKIPPED',
              'REJECTED',
            ],
          },
          voteScore: { type: 'integer' },
          voteCount: { type: 'integer' },
          queuePosition: { type: 'integer' },
          pinned: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Vote: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          songId: { type: 'string' },
          participantId: { type: 'string' },
          value: { type: 'integer', enum: [-1, 1] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  tags: [
    { name: 'Auth', description: 'Authentication & user management' },
    { name: 'Events', description: 'Event CRUD & state management' },
    { name: 'Songs', description: 'Song suggestions, queue & DJ operations' },
    {
      name: 'Participants',
      description: 'Join/leave events, participant management',
    },
    { name: 'Votes', description: 'Vote on songs' },
    { name: 'Health', description: 'Health check endpoints' },
  ],
  paths: {
    '/ping': {
      get: {
        tags: ['Health'],
        summary: 'Ping the API',
        responses: {
          200: {
            description: 'API is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    message: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/ping/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check (API + DB status)',
        responses: {
          200: {
            description: 'All systems healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    api: { type: 'boolean' },
                    database: { type: 'boolean' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          503: { description: 'Database unavailable' },
        },
      },
    },

    /* ── Auth ── */
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'displayName'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 },
                  displayName: { type: 'string' },
                  role: {
                    type: 'string',
                    enum: ['ATTENDEE', 'DJ'],
                    default: 'ATTENDEE',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'User registered',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/AuthResult' },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
          409: { description: 'Email already registered' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with credentials',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/AuthResult' },
                  },
                },
              },
            },
          },
          400: { description: 'Missing credentials' },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout and invalidate the current auth token',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Logged out',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: { success: { type: 'boolean' } },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid or expired token' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current authenticated user',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        user: { $ref: '#/components/schemas/User' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Not authenticated' },
        },
      },
    },

    /* ── Events ── */
    '/events': {
      post: {
        tags: ['Events'],
        summary: 'Create a new event',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'startsAt'],
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  startsAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Event created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        event: { $ref: '#/components/schemas/Event' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
          401: { description: 'Not authenticated' },
        },
      },
      get: {
        tags: ['Events'],
        summary: 'List active events',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 50 },
          },
          {
            name: 'skip',
            in: 'query',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          200: {
            description: 'List of active events',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        events: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Event' },
                        },
                        total: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Not authenticated' },
        },
      },
    },
    '/events/access/{accessCode}': {
      get: {
        tags: ['Events'],
        summary: 'Get event by access code',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'accessCode',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Event found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        event: { $ref: '#/components/schemas/Event' },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Event not found' },
        },
      },
    },
    '/events/{eventId}': {
      get: {
        tags: ['Events'],
        summary: 'Get event by ID',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Event details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        event: { $ref: '#/components/schemas/Event' },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Event not found' },
        },
      },
      put: {
        tags: ['Events'],
        summary: 'Update event',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  startsAt: { type: 'string', format: 'date-time' },
                  settings: { $ref: '#/components/schemas/EventSettings' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Event updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        event: { $ref: '#/components/schemas/Event' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
          404: { description: 'Event not found' },
        },
      },
    },
    '/events/{eventId}/start': {
      post: {
        tags: ['Events'],
        summary: 'Start an event (transition to LIVE)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Event started',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        event: { $ref: '#/components/schemas/Event' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid state transition' },
        },
      },
    },
    '/events/{eventId}/end': {
      post: {
        tags: ['Events'],
        summary: 'End an event',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Event ended' },
        },
      },
    },
    '/events/{eventId}/cancel': {
      post: {
        tags: ['Events'],
        summary: 'Cancel an event',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { reason: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Event cancelled' },
        },
      },
    },
    '/events/{eventId}/participants': {
      get: {
        tags: ['Events'],
        summary: 'Get event participants',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Participants list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        participants: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Participant' },
                        },
                        count: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    /* ── Songs ── */
    '/songs/{eventId}/suggest': {
      post: {
        tags: ['Songs'],
        summary: 'Suggest a song for an event',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['participantId', 'title', 'artist'],
                properties: {
                  participantId: { type: 'string' },
                  title: { type: 'string' },
                  artist: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Song suggested',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        song: { $ref: '#/components/schemas/Song' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
        },
      },
    },
    '/songs/{eventId}/queue': {
      get: {
        tags: ['Songs'],
        summary: 'Get approved song queue for an event',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Song queue',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        queue: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Song' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/songs/{eventId}/pending': {
      get: {
        tags: ['Songs'],
        summary: 'Get pending song suggestions for an event',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Pending songs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        pending: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Song' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/songs/{eventId}/{songId}/approve': {
      post: {
        tags: ['Songs'],
        summary: 'Approve a pending song (DJ only)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'songId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Song approved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        song: { $ref: '#/components/schemas/Song' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/songs/{eventId}/{songId}/reject': {
      post: {
        tags: ['Songs'],
        summary: 'Reject a pending song (DJ only)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'songId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { reason: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Song rejected' },
        },
      },
    },
    '/songs/{eventId}/{songId}/skip': {
      post: {
        tags: ['Songs'],
        summary: 'Skip a song (DJ only)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'songId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { reason: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Song skipped' },
        },
      },
    },
    '/songs/{songId}/position': {
      get: {
        tags: ['Songs'],
        summary: "Get a song's queue position",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'songId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Song position info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },

    /* ── Participants ── */
    '/participants/{eventId}/join': {
      post: {
        tags: ['Participants'],
        summary: 'Join an event as participant',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['nickname'],
                properties: {
                  nickname: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Joined event',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        participant: {
                          $ref: '#/components/schemas/Participant',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
          409: { description: 'Nickname taken' },
        },
      },
    },
    '/participants/{participantId}/leave': {
      post: {
        tags: ['Participants'],
        summary: 'Leave an event',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'participantId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Left event' },
        },
      },
    },
    '/participants/{participantId}': {
      get: {
        tags: ['Participants'],
        summary: 'Get participant by ID',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'participantId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Participant details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        participant: {
                          $ref: '#/components/schemas/Participant',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Participant not found' },
        },
      },
    },
    '/participants/{eventId}/list': {
      get: {
        tags: ['Participants'],
        summary: 'List participants for an event',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Participants list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        participants: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Participant' },
                        },
                        count: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/participants/{participantId}/premium': {
      put: {
        tags: ['Participants'],
        summary: 'Set participant premium status',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'participantId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['isPremium'],
                properties: {
                  isPremium: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Premium status updated' },
        },
      },
    },
    '/participants/{participantId}/cooldown': {
      post: {
        tags: ['Participants'],
        summary: 'Set participant cooldown',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'participantId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['durationMs'],
                properties: {
                  durationMs: {
                    type: 'integer',
                    description: 'Cooldown duration in milliseconds',
                  },
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Cooldown set' },
        },
      },
    },
    '/participants/{participantId}/kick': {
      post: {
        tags: ['Participants'],
        summary: 'Kick a participant from an event (DJ only)',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'participantId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { reason: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Participant kicked' },
        },
      },
    },

    /* ── Votes ── */
    '/votes': {
      post: {
        tags: ['Votes'],
        summary: 'Cast a vote on a song',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['songId', 'participantId', 'value'],
                properties: {
                  songId: { type: 'string' },
                  participantId: { type: 'string' },
                  value: {
                    type: 'integer',
                    enum: [-1, 1],
                    description: '1 = upvote, -1 = downvote',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Vote cast',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        vote: { $ref: '#/components/schemas/Vote' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: { description: 'Validation error' },
        },
      },
    },
    '/votes/{songId}/{participantId}': {
      delete: {
        tags: ['Votes'],
        summary: 'Remove a vote',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'songId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'participantId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: { description: 'Vote removed' },
        },
      },
      get: {
        tags: ['Votes'],
        summary: "Get a participant's vote on a song",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'songId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'participantId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Vote info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        vote: { $ref: '#/components/schemas/Vote' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/votes/{eventId}/stats': {
      get: {
        tags: ['Votes'],
        summary: 'Get vote statistics for an event',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Vote statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const swaggerSpec = swaggerJsdoc({
  swaggerDefinition,
  apis: [],
});

const initSwagger = (app) => {
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'SyncRekuest API Docs',
    }),
  );

  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
};

module.exports = { initSwagger, swaggerSpec };
