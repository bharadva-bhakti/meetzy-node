const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const CallSchema = new Schema(
  {
    initiator_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    group_id: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    receiver_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    call_type: {
      type: String,
      enum: ['audio', 'video'],
      required: true,
    },
    call_mode: {
      type: String,
      enum: ['direct', 'group'],
      default: 'direct',
    },
    status: {
      type: String,
      enum: ['active', 'ended'],
      default: 'active',
    },
    started_at: {
      type: Date,
      default: Date.now,
    },
    ended_at: {
      type: Date,
      default: null,
    },
    accepted_time: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number,
      default: null,
    },
    max_participants: {
      type: Number,
      default: 10,
    },
  },
  {
    collection: 'calls',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(CallSchema);

CallSchema.index({ initiator_id: 1, created_at: -1 });
CallSchema.index({ group_id: 1, created_at: -1 });
CallSchema.index({ receiver_id: 1, created_at: -1 });
CallSchema.index({ status: 1 });
CallSchema.index({ call_mode: 1 });
CallSchema.index({ status: 1, ended_at: 1 });
CallSchema.index({ call_type: 1, call_mode: 1 });
CallSchema.index({ started_at: 1 });

module.exports = mongoose.model('Call', CallSchema);