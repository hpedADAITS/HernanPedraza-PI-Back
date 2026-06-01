const { attendeeSessionService } = require('../services');
const { participantsSchema } = require('../schemas');
const { httpStatus } = require('../constants');
const { logger } = require('../utils');

let io = null;

class AttendeeSessionController {
  setIO(socketIO) {
    io = socketIO;
  }

  async joinEvent(req, res, next) {
    try {
      const { eventId } = req.params;
      const data = participantsSchema.parseJoinEvent(req.body);
      const session = await attendeeSessionService.joinEvent(
        eventId,
        data.nickname,
        data.profilePicture,
        data.password,
        {
          onDuplicateActive: (participant) => {
            if (!io) return;
            io.to(`event:${eventId}`).emit('attendee_password_prompt_requested', {
              participantId: participant._id,
              nickname: participant.nickname,
              reason: 'duplicate-login',
              requestedAt: new Date().toISOString(),
            });
          },
        },
      );

      res.status(httpStatus.CREATED).json({
        success: true,
        data: session,
      });
    } catch (error) {
      logger.error('Attendee session join error:', error);
      next(error);
    }
  }
}

module.exports = new AttendeeSessionController();
