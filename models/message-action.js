const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const MessageActionSchema = new Schema(
  {
    message_id: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    action_type: {
      type: String,
      enum: ['star', 'edit', 'forward', 'delete'],
      required: true,
    },
    details: { 
      type: Object, 
      default: null 
    },
  },
  {
    collection: 'message_actions',
    timestamps: true,
  }
);

addVirtualId(MessageActionSchema);

MessageActionSchema.index(
  { message_id: 1, user_id: 1, action_type: 1 },
  { unique: true }
);
MessageActionSchema.index({ user_id: 1 });
MessageActionSchema.index({ action_type: 1 });
MessageActionSchema.index({ created_at: 1 });

module.exports = mongoose.model('MessageAction', MessageActionSchema);