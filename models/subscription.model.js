const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SubscriptionSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    verification_request_id: {
      type: Schema.Types.ObjectId,
      ref: 'VerificationRequest',
      default: null,
    },
    plan_id: {
      type: Schema.Types.ObjectId,
      ref: 'Plan',
      required: true,
    },
    stripe_subscription_id: { 
      type: String, 
      unique: true, 
      sparse: true 
    },
    paypal_subscription_id: { 
      type: String, 
      unique: true, 
      sparse: true 
    },
    payment_gateway: {
      type: String,
      enum: ['stripe', 'paypal'],
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'trialing', 'unpaid'],
      default: 'incomplete',
    },
    current_period_start: { 
      type: Date, 
      default: null 
    },
    current_period_end: { 
      type: Date, 
      default: null 
    },
    cancel_at_period_end: { 
      type: Boolean, 
      default: false 
    },
    canceled_at: { 
      type: Date, 
      default: null 
    },
    billing_cycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      default: 'monthly',
    },
    amount: { 
      type: Number, 
      required: true 
    },
    currency: { 
      type: String, 
      default: 'USD', maxlength: 3 
    },
    metadata: { 
      type: Object, 
      default: {} 
    },
  },
  {
    collection: 'subscriptions',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(SubscriptionSchema);

module.exports = mongoose.model('Subscription', SubscriptionSchema);