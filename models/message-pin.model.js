const mongoose = require('mongoose');
const { Schema } = mongoose;

const MessagePinSchema = new Schema(
  {
    message_id: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
    },
    pinned_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    pinned_until: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'message_pins',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

MessagePinSchema.index({ message_id: 1 });

module.exports = mongoose.model('MessagePin', MessagePinSchema);