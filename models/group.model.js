const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const GroupSchema = new Schema(
  {
    name: { 
      type: String, 
      required: true
    },
    description: { 
      type: String, 
      default: null 
    },
    avatar: { 
      type: String, 
      default: null 
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    collection: 'groups',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(GroupSchema);

module.exports = mongoose.model('Group', GroupSchema);