const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const StickerSchema = new Schema(
  {
    title: { 
      type: String, 
      required: true 
    },
    sticker: { 
      type: String, 
      required: true, 
      unique: true 
    },
    metadata: { 
      type: Object, 
      default: null 
    },
    status: { 
      type: Boolean,
      default: true, 
      required: true 
    },
  },
  {
    collection: 'sticker',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(StickerSchema);

module.exports = mongoose.model('Sticker', StickerSchema);