const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const GroupMemberSchema = new Schema(
  {
    group_id: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      required: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member',
    },
  },
  {
    collection: 'group_members',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(GroupMemberSchema);

GroupMemberSchema.virtual('user', {ref: 'User', localField: 'user_id', foreignField: '_id', justOne: true,});
GroupMemberSchema.index({ group_id: 1, user_id: 1 }, { unique: true });
GroupMemberSchema.index({ user_id: 1 });
GroupMemberSchema.index({ group_id: 1, role: 1 });
GroupMemberSchema.index({ created_at: 1 });

module.exports = mongoose.model('GroupMember', GroupMemberSchema);