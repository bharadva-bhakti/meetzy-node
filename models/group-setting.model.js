const mongoose = require('mongoose');
const { Schema } = mongoose;

const GroupSettingSchema = new Schema(
  {
    group_id: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      required: true
    },
    allow_edit_info: {
      type: String,
      enum: ['admin', 'everyone'],
      default: 'admin',
    },
    allow_send_message: {
      type: String,
      enum: ['admin', 'everyone'],
      default: 'everyone',
    },
    allow_add_member: {
      type: String,
      enum: ['admin', 'everyone'],
      default: 'admin',
    },
    allow_mentions: {
      type: String,
      enum: ['admin', 'everyone'],
      default: 'everyone',
    },
  },
  {
    collection: 'group_settings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

GroupSettingSchema.index({ group_id: 1 }, { unique: true });

module.exports = mongoose.model('GroupSetting', GroupSettingSchema);