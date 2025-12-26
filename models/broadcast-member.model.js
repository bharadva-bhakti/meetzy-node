const mongoose = require('mongoose');
const { Schema } = mongoose;

const BroadcastMemberSchema = new Schema(
  {
    broadcast_id: {
      type: Schema.Types.ObjectId,
      ref: 'Broadcast',
      required: true,
    },
    recipient_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    added_at: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    collection: 'broadcast_members',
    timestamps: false,
  }
);

BroadcastMemberSchema.index({ broadcast_id: 1 });
BroadcastMemberSchema.index({ recipient_id: 1 });
BroadcastMemberSchema.index({ broadcast_id: 1, recipient_id: 1 }, { unique: true });

module.exports = mongoose.model('BroadcastMember', BroadcastMemberSchema);