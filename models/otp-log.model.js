const mongoose = require('mongoose');
const { Schema } = mongoose;

const OTPLogSchema = new Schema(
  {
    email: { 
      type: String, 
      default: null 
    },
    phone: { 
      type: String, 
      default: null 
    },
    otp: { 
      type: String, 
      required: true 
    },
    expires_at: { 
      type: Date, 
      required: true 
    },
    verified: { 
      type: Boolean, 
      default: false
     },
  },
  {
    collection: 'otp_logs',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

OTPLogSchema.index({ email: 1 });
OTPLogSchema.index({ phone: 1 });
OTPLogSchema.index({ expires_at: 1 });
OTPLogSchema.index({ verified: 1 });
OTPLogSchema.index({ email: 1, verified: 1 });

module.exports = mongoose.model('OTPLog', OTPLogSchema);