const mongoose = require('mongoose');
const { Schema } = mongoose;

const MutedStatusSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    target_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    collection: 'muted_status',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

MutedStatusSchema.index({ user_id: 1, target_id: 1 }, { unique: true });

module.exports = mongoose.model('MutedStatus', MutedStatusSchema);