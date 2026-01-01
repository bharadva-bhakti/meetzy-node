const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const ChatClearSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipient_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    group_id: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    broadcast_id: {
      type: Schema.Types.ObjectId,
      ref: 'Broadcast',
      default: null,
    },
    cleared_at: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    collection: 'chat_clears',
    timestamps: false,
  }
);

addVirtualId(ChatClearSchema);

ChatClearSchema.index(
  { user_id: 1, recipient_id: 1 }, { unique: true, partialFilterExpression: { recipient_id: { $ne: null }}}
);

ChatClearSchema.index(
  { user_id: 1, group_id: 1 }, { unique: true, partialFilterExpression: { group_id: { $ne: null }}}
);

ChatClearSchema.index(
  { user_id: 1, broadcast_id: 1 }, { unique: true, partialFilterExpression: { broadcast_id: { $ne: null }}}
);

module.exports = mongoose.model('ChatClear', ChatClearSchema);