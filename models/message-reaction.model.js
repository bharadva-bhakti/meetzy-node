const mongoose = require('mongoose');
const { Schema } = mongoose;

const MessageReactionSchema = new Schema(
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
    emoji: {
      type: String,
      required: true,
    },
  },
  {
    collection: 'message_reactions',
    timestamps: true,
  }
);

MessageReactionSchema.index(
  { message_id: 1, user_id: 1, emoji: 1 },
  { unique: true }
);
MessageReactionSchema.index({ user_id: 1 });
MessageReactionSchema.index({ emoji: 1 });
MessageReactionSchema.index({ created_at: 1 });

module.exports = mongoose.model('MessageReaction', MessageReactionSchema);