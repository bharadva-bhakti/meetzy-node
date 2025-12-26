const mongoose = require('mongoose');
const { Schema } = mongoose;

const StatusSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'video'],
      default: 'text',
    },
    file_url: { 
        type: String, 
        default: null 
    },
    caption: { 
        type: String, 
        default: null 
    },
    sponsored: { 
        type: Boolean,
        default: false, 
        required: true 
    },
    expires_at: {
      type: Date,
      required: true,
    },
  },
  {
    collection: 'statuses',
    timestamps: { createdAt: 'created_at', updatedAt: false },
  }
);

StatusSchema.index({ user_id: 1 });
StatusSchema.index({ expires_at: 1 });
StatusSchema.index({ type: 1 });
StatusSchema.index({ user_id: 1, expires_at: 1 });
StatusSchema.index({ created_at: -1 });

module.exports = mongoose.model('Status', StatusSchema);