const mongoose = require('mongoose');
const { Schema } = mongoose;

const CallParticipantSchema = new Schema(
  {
    call_id: {
      type: Schema.Types.ObjectId,
      ref: 'Call',
      required: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['invited', 'joined', 'declined', 'missed', 'left', 'kicked'],
      default: 'invited',
    },
    joined_at: { 
      type: Date, 
      default: null 
    },
    left_at: { 
      type: Date, 
      default: null 
    },
    is_muted: { 
      type: Boolean, 
      default: false 
    },
    is_screen_sharing: { 
      type: Boolean, 
      default: false 
    },
    is_video_enabled: { 
      type: Boolean, 
      default: false 
    },
    video_status: {
      type: String,
      enum: ['enabled', 'disabled', 'unavailable'],
      default: 'disabled',
    },
    peer_id: { 
      type: String, 
      default: null 
    },
  },
  {
    collection: 'call_participants',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

CallParticipantSchema.index({ call_id: 1, user_id: 1 }, { unique: true });
CallParticipantSchema.index({ user_id: 1, status: 1 });
CallParticipantSchema.index({ call_id: 1, status: 1 });
CallParticipantSchema.index({ user_id: 1, joined_at: 1 });
CallParticipantSchema.index({ status: 1, joined_at: 1 });
CallParticipantSchema.index({ peer_id: 1 });

module.exports = mongoose.model('CallParticipant', CallParticipantSchema);