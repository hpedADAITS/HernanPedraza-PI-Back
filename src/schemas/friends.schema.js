const { ValidationError } = require('../errors');

const OBJECT_ID = /^[a-f\d]{24}$/i;

function isObjectIdString(value) {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

class FriendsSchema {
  parseSendRequest(body) {
    if (!isObjectIdString(body.toUserId)) {
      throw new ValidationError('toUserId is required');
    }
    const data = {
      toUserId: body.toUserId,
      message: typeof body.message === 'string' && body.message.trim()
        ? body.message.trim().slice(0, 200)
        : null,
    };
    return data;
  }

  parseRespondRequest(body) {
    if (body.accept === true) return { accept: true };
    if (body.accept === false) return { accept: false };
    throw new ValidationError('accept must be a boolean');
  }

  parseUnfriendParams(params) {
    if (!isObjectIdString(params.friendId)) {
      throw new ValidationError('friendId is required');
    }
    return { friendId: params.friendId };
  }

  parseInvite(body) {
    if (!isObjectIdString(body.friendId)) {
      throw new ValidationError('friendId is required');
    }
    if (!isNonEmptyString(body.eventCode, 32)) {
      throw new ValidationError('eventCode is required');
    }
    const data = {
      friendId: body.friendId,
      eventCode: body.eventCode.trim().toUpperCase(),
      eventId: isObjectIdString(body.eventId) ? body.eventId : null,
      eventName: typeof body.eventName === 'string' && body.eventName.trim()
        ? body.eventName.trim().slice(0, 100)
        : null,
      message: typeof body.message === 'string' && body.message.trim()
        ? body.message.trim().slice(0, 200)
        : null,
    };
    return data;
  }

  parseRespondInvite(body) {
    if (body.accept === true) return { accept: true };
    if (body.accept === false) return { accept: false };
    throw new ValidationError('accept must be a boolean');
  }
}

module.exports = new FriendsSchema();
