const mongoose = require('mongoose');
const { Schema } = mongoose;

const PlanSchema = new Schema(
  {
    name: { 
        type: String, 
        required: true 
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      match: /^[a-z0-9-]+$/,
    },
    description: { 
        type: String, 
        default: null 
    },

    // Pricing
    price_per_user_per_month: {
      type: Number,
      required: true,
      default: 0.00,
      min: 0,
    },
    price_per_user_per_year: {
      type: Number,
      default: null,
      min: 0,
    },
    billing_cycle: {
      type: String,
      enum: ['monthly', 'yearly', 'both'],
      default: 'monthly',
    },
    stripe_price_id: { type: String, default: null },

    // Features
    max_members_per_group: {
      type: Number,
      required: true,
      default: 10,
      min: 1,
    },
    max_broadcasts_list: { type: Number, required: true, default: 10 },
    max_members_per_broadcasts_list: {
      type: Number,
      required: true,
      default: 10,
      min: 1,
    },
    max_status: { 
        type: Number, 
        required: true, 
        default: 10 
    },
    max_storage_per_user_mb: { 
        type: Number, 
        required: true, 
        default: 5000 
    },
    max_groups: { 
        type: Number, 
        required: true, 
        default: 50 
    },
    allows_file_sharing: { 
        type: Boolean,
        default: true 
    },
    features: { 
        type: Object, 
        default: {} 
    },

    display_order: { 
        type: Number, 
        default: 0 
    },
    is_default: { 
        type: Boolean, 
        default: false 
    },
    trial_period_days: { 
        type: Number, 
        default: 0, 
        min: 0 
    },
    status: { 
        type: String, 
        enum: ['active', 'inactive'], 
        default: 'active' 
    },

    deleted_at: { 
        type: Date, 
        default: null 
    },
  },
  {
    collection: 'plans',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

PlanSchema.index({ slug: 1 }, { unique: true });
PlanSchema.index({ status: 1, display_order: 1 });

PlanSchema.methods.isFreePlan = function () {
  return this.price_per_user_per_month === 0;
};

PlanSchema.methods.hasTrial = function () {
  return this.trial_period_days > 0;
};

PlanSchema.methods.getYearlyPrice = function () {
  if (this.price_per_user_per_year) {
    return this.price_per_user_per_year;
  }
  return Number((this.price_per_user_per_month * 12 * 0.8).toFixed(2));
};

module.exports = mongoose.model('Plan', PlanSchema);