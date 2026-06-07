const { friendsService } = require('../services');
const { friendsSchema } = require('../schemas');
const { httpStatus } = require('../constants');
const { logger } = require('../utils');

class FriendsController {
  async sendRequest(req, res, next) {
    try {
      const data = friendsSchema.parseSendRequest(req.body);
      const result = await friendsService.sendFriendRequest(
        req.user.userId,
        data.toUserId,
        data.message,
      );
      res.status(httpStatus.CREATED).json({ success: true, data: result });
    } catch (error) {
      logger.error('Send friend request error:', error);
      next(error);
    }
  }

  async cancelRequest(req, res, next) {
    try {
      const { id } = req.params;
      const result = await friendsService.cancelFriendRequest(id, req.user.userId);
      res.status(httpStatus.OK).json({ success: true, data: result });
    } catch (error) {
      logger.error('Cancel friend request error:', error);
      next(error);
    }
  }

  async listRequests(req, res, next) {
    try {
      const direction = (req.query.direction || 'incoming').toString();
      const list =
        direction === 'outgoing'
          ? await friendsService.listOutgoingRequests(req.user.userId)
          : await friendsService.listIncomingRequests(req.user.userId);
      res.status(httpStatus.OK).json({ success: true, data: { requests: list } });
    } catch (error) {
      logger.error('List friend requests error:', error);
      next(error);
    }
  }

  async respondRequest(req, res, next) {
    try {
      const { id } = req.params;
      const { accept } = friendsSchema.parseRespondRequest(req.body);
      const result = await friendsService.respondFriendRequest(id, req.user.userId, accept);
      res.status(httpStatus.OK).json({ success: true, data: result });
    } catch (error) {
      logger.error('Respond friend request error:', error);
      next(error);
    }
  }

  async listFriends(req, res, next) {
    try {
      const friends = await friendsService.listFriends(req.user.userId);
      res.status(httpStatus.OK).json({ success: true, data: { friends } });
    } catch (error) {
      logger.error('List friends error:', error);
      next(error);
    }
  }

  async unfriend(req, res, next) {
    try {
      const { friendId } = friendsSchema.parseUnfriendParams(req.params);
      const result = await friendsService.unfriend(req.user.userId, friendId);
      res.status(httpStatus.OK).json({ success: true, data: result });
    } catch (error) {
      logger.error('Unfriend error:', error);
      next(error);
    }
  }

  async sendInvite(req, res, next) {
    try {
      const data = friendsSchema.parseInvite(req.body);
      const result = await friendsService.sendEventInvite(req.user.userId, data);
      res.status(httpStatus.CREATED).json({ success: true, data: result });
    } catch (error) {
      logger.error('Send event invite error:', error);
      next(error);
    }
  }

  async listInvites(req, res, next) {
    try {
      const direction = (req.query.direction || 'incoming').toString();
      const list =
        direction === 'outgoing'
          ? await friendsService.listOutgoingInvites(req.user.userId)
          : await friendsService.listIncomingInvites(req.user.userId);
      res.status(httpStatus.OK).json({ success: true, data: { invites: list } });
    } catch (error) {
      logger.error('List event invites error:', error);
      next(error);
    }
  }

  async respondInvite(req, res, next) {
    try {
      const { id } = req.params;
      const { accept } = friendsSchema.parseRespondInvite(req.body);
      const result = await friendsService.respondEventInvite(id, req.user.userId, accept);
      res.status(httpStatus.OK).json({ success: true, data: result });
    } catch (error) {
      logger.error('Respond event invite error:', error);
      next(error);
    }
  }
}

module.exports = new FriendsController();
