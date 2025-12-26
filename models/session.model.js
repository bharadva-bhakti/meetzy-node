const mongoose = require('mongoose');
const { Schema } = mongoose;

const SessionSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    session_token: {
      type: String,
      required: true,
      unique: true,
    },
    device_info: { 
      type: String, 
      default: null 
    },
    ip_address: { 
      type: String, 
      default: null 
    },
    agenda: { 
      type: String, 
      default: null 
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    expires_at: {
      type: Date,
      required: true,
    },
  },
  {
    collection: 'sessions',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

SessionSchema.index({ user_id: 1, status: 1 });
SessionSchema.index({ expires_at: 1 });
SessionSchema.index({ session_token: 1 });
SessionSchema.index({ agenda: 1 });
SessionSchema.index({ created_at: 1 });

module.exports = mongoose.model('Session', SessionSchema);