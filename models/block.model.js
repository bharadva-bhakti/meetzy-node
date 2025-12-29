const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const BlockSchema = new Schema(
  {
    blocker_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    blocked_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    group_id: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    block_type: {
      type: String,
      enum: ['user', 'group'],
      required: true,
      default: 'user',
    },
  },
  {
    collection: 'blocks',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(BlockSchema);

BlockSchema.index(
  { blocker_id: 1, blocked_id: 1 }, 
  { unique: true, partialFilterExpression: 
    { block_type: 'user', blocked_id: { $exists: true } } 
  }
);
BlockSchema.index(
  { blocker_id: 1, group_id: 1 }, 
  { unique: true, partialFilterExpression: 
    { block_type: 'group', group_id: { $exists: true } } 
  }
);

module.exports = mongoose.model('Block', BlockSchema);