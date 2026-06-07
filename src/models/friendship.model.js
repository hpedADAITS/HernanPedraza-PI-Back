const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const FriendshipSchema = new Schema(
  {
    /* Friendship is stored as two rows per pair so "list my friends" is a
       single indexed lookup. The (userId, friendId) pair is unique. */
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    friendId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /* Back-reference to the FriendRequest that produced this friendship
       (so we can audit the chain of acceptance). */
    fromRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'FriendRequest',
      default: null,
    },
    since: { type: Date, default: () => new Date(), index: true },
  },
  { timestamps: true },
);

FriendshipSchema.index({ userId: 1, friendId: 1 }, { unique: true });

const FriendshipModel = model('Friendship', FriendshipSchema, 'friendships');

module.exports = { FriendshipModel };
