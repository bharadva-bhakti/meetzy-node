const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const PaymentSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    currency: { 
      type: String, 
      default: 'USD', 
      maxlength: 3 
    },
    payment_gateway: {
      type: String,
      enum: ['stripe', 'paypal', 'razorpay'],
      required: true,
    },
    payment_method: { 
      type: String, 
      default: null 
    },
    gateway_order_id: { 
      type: String, 
      default: null 
    },
    gateway_payment_id: { 
      type: String, 
      default: null 
    },
    reference_type: {
      type: String,
      enum: ['blue_tick'],
      required: true,
    },
    reference_id: { type: Number, default: null },
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending',
    },
    gateway_response: { 
      type: Object, 
      default: {} 
    },
    failure_reason: { 
      type: String, 
      default: null 
    },
    completed_at: { 
      type: Date, 
      default: null 
    },
    refunded_at: { 
      type: Date, 
      default: null 
    },
    subscription_id: {
      type: Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    is_recurring: { 
      type: Boolean,
      default: false 
    },
    invoice_id: { 
      type: String, 
      default: null 
    },
    subscription_payment_sequence: { 
      type: Number, 
      default: 1 
    },
  },
  {
    collection: 'payments',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(PaymentSchema);

PaymentSchema.index({ user_id: 1 });
PaymentSchema.index({ status: 1 });
PaymentSchema.index({ reference_type: 1, reference_id: 1 });
PaymentSchema.index({ gateway_order_id: 1 });
PaymentSchema.index({ gateway_payment_id: 1 });

module.exports = mongoose.model('Payment', PaymentSchema);