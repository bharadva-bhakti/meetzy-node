const mongoose = require('mongoose');
const { Schema } = mongoose;

const FaqSchema = new Schema(
  {
    title: { 
      type: String, 
      required: true, unique: true 
    },
    description: { 
      type: String, 
      required: true 
    },
    status: { 
      type: Boolean,
      default: true
    },
  },
  {
    collection: 'faqs',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

module.exports = mongoose.model('Faq', FaqSchema);