const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const ArchiveSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    target_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    target_type: {
      type: String,
      enum: ['user', 'group', 'broadcast', 'announcement'],
      required: true,
    },
  },
  {
    collection: 'archives',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(ArchiveSchema);

ArchiveSchema.index({ user_id: 1, target_type: 1, target_id: 1 }, { unique: true });
ArchiveSchema.index({ user_id: 1 });
ArchiveSchema.index({ target_type: 1, target_id: 1 });
ArchiveSchema.index({ created_at: 1 });

module.exports = mongoose.model('Archive', ArchiveSchema);