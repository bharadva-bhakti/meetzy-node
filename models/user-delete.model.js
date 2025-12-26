const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserDeleteSchema = new Schema(
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
      enum: ['user', 'group'],
      required: true,
    },
    delete_type: {
      type: String,
      enum: ['hide_chat', 'delete_messages'],
      default: 'hide_chat',
      required: true,
    },
  },
  {
    collection: 'user_deletes',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

UserDeleteSchema.index(
  { user_id: 1, target_type: 1, target_id: 1 },
  { unique: true }
);
UserDeleteSchema.index({ user_id: 1 });
UserDeleteSchema.index({ delete_type: 1 });
UserDeleteSchema.index({ created_at: 1 });

module.exports = mongoose.model('UserDelete', UserDeleteSchema);