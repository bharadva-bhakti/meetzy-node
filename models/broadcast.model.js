const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const BroadcastSchema = new Schema(
  {
    creator_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
  },
  {
    collection: 'broadcasts',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(BroadcastSchema);

BroadcastSchema.index({ creator_id: 1 });

module.exports = mongoose.model('Broadcast', BroadcastSchema);