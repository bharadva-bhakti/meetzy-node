const mongoose = require('mongoose');
const { addVirtualId } = require('../utils/modelHelper');

const PlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]+$/,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    price_per_user_per_month: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    price_per_user_per_year: {
      type: Number,
      min: 0,
      default: null,
    },
    billing_cycle: {
      type: String,
      enum: ['monthly', 'yearly', 'both'],
      default: 'monthly',
    },
    stripe_price_id: {
      type: String,
      default: null,
    },

    max_members_per_group: {
      type: Number,
      required: true,
      min: 1,
      default: 10,
    },
    max_broadcasts_list: {
      type: Number,
      required: true,
      default: 10,
    },
    max_members_per_broadcasts_list: {
      type: Number,
      required: true,
      min: 1,
      default: 10,
    },
    max_status: {
      type: Number,
      required: true,
      default: 10,
    },
    max_storage_per_user_mb: {
      type: Number,
      required: true,
      default: 5000,
    },
    max_groups: {
      type: Number,
      required: true,
      default: 50,
    },
    allows_file_sharing: {
      type: Boolean,
      default: true,
    },
    features: {
      type: Object,
      default: {},
    },
    display_order: {
      type: Number,
      default: 0,
    },
    is_default: {
      type: Boolean,
      default: false,
    },
    trial_period_days: {
      type: Number,
      min: 0,
      default: 0,
    },
    video_calls_enabled: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  {
    timestamps: true,
    collection: 'plans',
  }
);

addVirtualId(PlanSchema);

PlanSchema.index({ slug: 1 }, { unique: true });
PlanSchema.index({ status: 1, display_order: 1 });

// Instance methods
PlanSchema.methods.isFreePlan = function () {
  return this.price_per_user_per_month === 0;
};

PlanSchema.methods.hasTrial = function () {
  return this.trial_period_days > 0;
};

PlanSchema.methods.getYearlyPrice = function () {
  if (this.price_per_user_per_year !== null && this.price_per_user_per_year !== undefined) {
    return this.price_per_user_per_year;
  }
  return Number((this.price_per_user_per_month * 12 * 0.8).toFixed(2));
};

module.exports = mongoose.model('Plan', PlanSchema);