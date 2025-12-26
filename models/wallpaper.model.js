const mongoose = require('mongoose');
const { Schema } = mongoose;

const WallpaperSchema = new Schema(
  {
    name: { 
      type: String, 
      required: true 
    },
    wallpaper: { 
      type: String, 
      default: null 
    },
    status: { 
      type: Boolean, 
      default: true, 
      required: true 
    },
    is_default: { 
      type: Boolean, 
      default: false, 
      required: true 
    },
    metadata: { 
      type: Object, 
      default: null 
    },
  },
  {
    collection: 'wallpapers',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

WallpaperSchema.index({ status: 1 });
WallpaperSchema.index({ created_at: 1 });

module.exports = mongoose.model('Wallpaper', WallpaperSchema);