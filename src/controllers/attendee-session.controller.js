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

  async markTutorialAsSeen(req, res, next) {
    try {
      const result = await attendeeSessionService.markTutorialAsSeen(req.user.userId);

      res.status(httpStatus.OK).json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Mark tutorial as seen error:', error);
      next(error);
    }
  }
}

module.exports = new AttendeeSessionController();
