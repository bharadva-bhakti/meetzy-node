const mongoose = require('mongoose');
const { Schema } = mongoose;

const MutedChatSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    target_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    target_type: {
      type: String,
      enum: ['user', 'group', 'announcement'],
      required: true,
    },
    muted_until: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'muted_chats',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

MutedChatSchema.index(
  { user_id: 1, target_id: 1, target_type: 1 },
  { unique: true }
);
MutedChatSchema.index({ muted_until: 1 });
MutedChatSchema.index({ target_type: 1 });
MutedChatSchema.index({ created_at: 1 });

module.exports = mongoose.model('MutedChat', MutedChatSchema);