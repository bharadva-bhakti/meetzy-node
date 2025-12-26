const mongoose = require('mongoose');
const { Schema } = mongoose;

const NotificationSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    from_user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    type: {
      type: String,
      enum: ['friend_request', 'friend_accepted', 'friend_rejected', 'message', 'group_invite', 'system'],
      required: true,
    },
    title: { 
        type: String, 
        required: true 
    },
    message: { 
        type: String, 
        default: null 
    },
    data: { 
        type: Object, 
        default: null 
    },
    is_read: { 
        type: Boolean, 
        default: false
    },
    read_at: { 
        type: Date, 
        default: null 
    },
  },
  {
    collection: 'notifications',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

NotificationSchema.index({ user_id: 1, is_read: 1 });
NotificationSchema.index({ type: 1 });
NotificationSchema.index({ from_user_id: 1 });
NotificationSchema.index({ created_at: -1 });
NotificationSchema.index({ read_at: 1 });

module.exports = mongoose.model('Notification', NotificationSchema);