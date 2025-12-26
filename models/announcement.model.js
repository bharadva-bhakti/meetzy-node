const mongoose = require('mongoose');
const { Schema } = mongoose;

const AnnouncementSchema = new Schema(
  {
    message_id: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
    },
    title: {
      type: String,
      maxlength: 255,
      default: null,
    },
    announcement_type: {
      type: String,
      enum: ['get_started', 'learn_more', 'none'],
      default: null,
    },
    action_link: {
      type: String,
      maxlength: 500,
      default: null,
    },
    redirect_url: {
      type: String,
      maxlength: 500,
      default: null,
    },
  },
  {
    collection: 'announcements',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

AnnouncementSchema.index({ message_id: 1 }, { unique: true });
AnnouncementSchema.index({ announcement_type: 1 });

module.exports = mongoose.model('Announcement', AnnouncementSchema);