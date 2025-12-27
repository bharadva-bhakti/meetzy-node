const mongoose = require('mongoose');
const { Schema } = mongoose;

const FaqSchema = new Schema(
  {
    title: { 
      type: String, 
      required: true
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

FaqSchema.index({ title: 1 }, { 
  unique: true, 
  collation: { locale: 'en', strength: 2 }
});

module.exports = mongoose.model('Faq', FaqSchema);