const mongoose = require('mongoose');
const { Schema } = mongoose;

const PageSchema = new Schema(
  {
    title: { 
      type: String, 
      required: true 
    },
    slug: { 
      type: String, 
      required: true, 
      unique: true 
    },
    content: { 
      type: String, 
      default: null 
    },
    meta_title: { 
      type: String, 
      default: null 
    },
    meta_description: { 
      type: String, 
      default: null 
    },
    status: { 
      type: Boolean,
      default: true 
    },
    created_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    collection: 'pages',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

PageSchema.index({ slug: 1 });
PageSchema.index({ status: 1 });
PageSchema.index({ created_by: 1 });
PageSchema.index({ created_at: 1 });

module.exports = mongoose.model('Page', PageSchema);