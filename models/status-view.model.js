const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const StatusViewSchema = new Schema(
  {
    status_id: {
      type: Schema.Types.ObjectId,
      ref: 'Status',
      required: true,
    },
    viewer_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    viewer_at: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    collection: 'status_views',
    timestamps: false,
  }
);

addVirtualId(StatusViewSchema);

// Unique: one user views a status only once
StatusViewSchema.index({ status_id: 1, viewer_id: 1 }, { unique: true });
StatusViewSchema.index({ status_id: 1 });
StatusViewSchema.index({ viewer_id: 1 });
StatusViewSchema.index({ viewer_at: -1 });

module.exports = mongoose.model('StatusView', StatusViewSchema);