const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const MessageStatusSchema = new Schema(
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
    status: {
      type: String,
      enum: ['sent', 'delivered', 'seen', 'blocked'],
      default: 'sent',
      required: true,
    },
  },
  {
    collection: 'message_statuses',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(MessageStatusSchema);

MessageStatusSchema.index({ message_id: 1 });
MessageStatusSchema.index({ user_id: 1 });
MessageStatusSchema.index({ status: 1 });
MessageStatusSchema.index({ message_id: 1, status: 1 });
MessageStatusSchema.index({ user_id: 1, status: 1 });
MessageStatusSchema.index({ created_at: 1 });

module.exports = mongoose.model('MessageStatus', MessageStatusSchema);