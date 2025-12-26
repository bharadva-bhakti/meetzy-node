const mongoose = require('mongoose');
const { Schema } = mongoose;

const PinnedConversationSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['group', 'direct', 'broadcast', 'announcement'],
      required: true,
    },
    target_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    pinned_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: 'pinned_conversations',
    timestamps: { createdAt: false, updatedAt: false },
  }
);

PinnedConversationSchema.index(
  { user_id: 1, type: 1, target_id: 1 },
  { unique: true }
);
PinnedConversationSchema.index({ pinned_at: -1 });
PinnedConversationSchema.index({ type: 1 });

module.exports = mongoose.model('PinnedConversation', PinnedConversationSchema);