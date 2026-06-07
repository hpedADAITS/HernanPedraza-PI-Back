const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const FriendRequestSchema = new Schema(
  {
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    toUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'denied', 'cancelled'],
      default: 'pending',
      index: true,
    },
    /* Optional short note (≤200 chars) attached by the requester. */
    message: { type: String, default: null, maxlength: 200 },
    createdAt: { type: Date, default: () => new Date(), index: true },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/* Only one active request per (from, to) pair. The unique key is built
   from the user ids so an A→B request can't be sent twice while pending. */
FriendRequestSchema.index(
  { fromUserId: 1, toUserId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } },
);
FriendRequestSchema.index({ toUserId: 1, status: 1, createdAt: -1 });
FriendRequestSchema.index({ fromUserId: 1, status: 1, createdAt: -1 });

const FriendRequestModel = model('FriendRequest', FriendRequestSchema, 'friend_requests');

module.exports = { FriendRequestModel };
