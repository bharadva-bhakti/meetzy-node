const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const UserReportSchema = new Schema(
  {
    reporter_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reported_user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    group_id: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    chat_type: {
      type: String,
      enum: ['direct', 'group'],
      required: true,
    },
    reason: { 
      type: String, 
      required: true 
    },
    description: { 
      type: String, 
      default: null 
    },
    status: {
      type: String,
      enum: ['pending', 'under_review', 'resolved', 'dismissed', 'banned'],
      default: 'pending',
    },
    admin_notes: { 
      type: String, 
      default: null 
    },
    resolved_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolved_at: { 
      type: Date, 
      default: null 
    },
  },
  {
    collection: 'user_reports',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(UserReportSchema);

UserReportSchema.index({ reporter_id: 1 });
UserReportSchema.index({ reported_user_id: 1 });
UserReportSchema.index({ group_id: 1 });
UserReportSchema.index({ chat_type: 1 });
UserReportSchema.index({ status: 1 });
UserReportSchema.index({ resolved_at: 1 });
UserReportSchema.index({ created_at: -1 });
UserReportSchema.index({ reporter_id: 1, status: 1 });

module.exports = mongoose.model('UserReport', UserReportSchema);