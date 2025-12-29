const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const ReportReasonSchema = new Schema(
  {
    title: { 
      type: String, 
      required: true 
    },
  },
  {
    collection: 'report_reasons',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(ReportReasonSchema);

module.exports = mongoose.model('ReportReason', ReportReasonSchema);