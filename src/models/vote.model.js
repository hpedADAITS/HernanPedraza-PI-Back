const mongoose = require('mongoose');

const { Schema, model } = mongoose;

const VoteSchema = new Schema(
  {
    songId: {
      type: Schema.Types.ObjectId,
      ref: 'Song',
      required: true,
      index: true,
    },
    participantId: {
      type: Schema.Types.ObjectId,
      ref: 'Participant',
      required: true,
      index: true,
    },
    value: { type: Number, required: true, enum: [-1, 1] },
  },
  { timestamps: true },
);

VoteSchema.index({ songId: 1, participantId: 1 }, { unique: true });
VoteSchema.index({ songId: 1, createdAt: -1 });

const VoteModel = model('Vote', VoteSchema, 'votes');

module.exports = {
  VoteModel,
};
