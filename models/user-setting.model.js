const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');
const UserSettingSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Privacy settings
    last_seen: { 
      type: Boolean, 
      default: true 
    },
    profile_pic: { 
      type: Boolean, 
      default: true 
    },
    display_bio: { 
      type: Boolean, 
      default: true 
    },
    read_receipts: { 
      type: Boolean, 
      default: true 
    },
    typing_indicator: { 
      type: Boolean, 
      default: true 
    },
    hide_phone: { 
      type: Boolean, 
      default: false 
    },

    // Status privacy
    status_privacy: {
      type: String,
      enum: ['my_contacts', 'only_share_with'],
      default: 'my_contacts',
      required: true,
    },
    shared_with: { 
      type: [Schema.Types.ObjectId], 
      default: [], 
      ref: 'User' 
    },

    // Customizer
    chat_wallpaper: { 
      type: String, 
      default: 'none', 
      required: true 
    },
    mode: { 
      type: String, 
      enum: ['light', 'dark'], 
      default: 'light', 
      required: true 
    },
    color: { 
      type: String, 
      default: 'style', 
      required: true 
    },
    layout: { 
      type: String, 
      default: 'default-layout', 
      required: true 
    },
    sidebar: { 
      type: String, 
      enum: ['three-column', 'two-column'], 
      default: 'three-column', 
      required: true 
    },
    direction: { 
      type: String, 
      enum: ['ltr', 'rtl'], 
      default: 'ltr', 
      required: true 
    },

    // Chat backup
    auto_backup: { 
      type: Boolean, 
      default: false, 
      required: true 
    },
    doc_backup: { 
      type: Boolean, 
      default: false, 
      required: true 
    },
    video_backup: { 
      type: Boolean, 
      default: false, 
      required: true 
    },

    // Chat lock
    pin_hash: {
      type: String, 
      default: null 
    },
    chat_lock_enabled: {
      type: Boolean, 
      default: false,
      required: true 
    },
    locked_chat_ids: {
      type: [
        {
          type: {
            type: String,
            enum: ['user', 'group', 'broadcast', 'announcement'],
            required: true
          },
          id: {
            type: Schema.Types.ObjectId,
            required: true
          }
        }
      ],
      default: []
    },
    chat_lock_digit: { 
      type: Number, 
      default: 4, 
      required: true 
    },
  },
  {
    collection: 'user_settings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(UserSettingSchema);

UserSettingSchema.index({ user_id: 1 }, { unique: true });

module.exports = mongoose.model('UserSetting', UserSettingSchema);