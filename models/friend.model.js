const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const FriendSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    friend_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'blocked'],
      default: 'pending',
    },
    requested_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    collection: 'friends',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(FriendSchema);

FriendSchema.index({ user_id: 1, friend_id: 1 }, { unique: true });
FriendSchema.index({ status: 1 });
FriendSchema.index({ requested_by: 1 });
FriendSchema.index({ user_id: 1, status: 1 });
FriendSchema.index({ created_at: 1 });

module.exports = mongoose.model('Friend', FriendSchema);