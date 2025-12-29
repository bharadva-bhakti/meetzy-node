const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const ChatSettingSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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
    disappearing_enabled: {
      type: Boolean,
      default: false,
    },
    duration: {
      type: String,
      default: null,
    },
    expire_after_seconds: {
      type: Number,
      default: null,
    },
  },
  {
    collection: 'chat_settings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(ChatSettingSchema);

module.exports = mongoose.model('ChatSetting', ChatSettingSchema);