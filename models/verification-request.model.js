const mongoose = require('mongoose');
const { Schema } = mongoose;

const VerificationRequestSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    request_id: {
      type: String,
      default: () => require('uuid').v4(),
      unique: true,
    },
    full_name: { 
        type: String, 
        required: true 
    },
    category: {
      type: String,
      enum: ['individual', 'business', 'creator'],
      required: true,
    },
    document_type: { 
        type: String, 
        default: null 
    },
    document_front: { 
        type: String, 
        default: null 
    },
    document_back: { 
        type: String, 
        default: null 
    },
    selfie: { 
        type: String, 
        default: null 
    },
    status: {
      type: String,
      enum: ['pending', 'payment_failed', 'approved', 'rejected'],
      default: 'pending',
    },
    payment_id: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    verification_source: {
      type: String,
      enum: ['user_paid', 'subscription', 'admin_granted'],
      default: 'user_paid',
      required: true,
    },
    subscription_id: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    rejection_reason: { 
        type: String, 
        default: null 
    },
    reviewed_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewed_at: { 
        type: Date, 
        default: null 
    },
    admin_notes: { 
        type: String, 
        default: null 
    },
  },
  {
    collection: 'verification_requests',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

VerificationRequestSchema.index({ user_id: 1 });
VerificationRequestSchema.index({ request_id: 1 });
VerificationRequestSchema.index({ status: 1 });
VerificationRequestSchema.index({ reviewed_by: 1 });
VerificationRequestSchema.index({ reviewed_at: 1 });

module.exports = mongoose.model('VerificationRequest', VerificationRequestSchema);