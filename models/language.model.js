const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const LanguageSchema = new Schema(
  {
    name: { 
      type: String, 
      maxlength: 50, 
      required: true 
    },
    locale: { 
      type: String, 
      maxlength: 10, 
      required: true, 
      unique: true 
    },
    is_active: { 
      type: Boolean,
      default: true 
    },
    translation_json: { 
      type: Object, 
      default: null 
    }
  },
  {
    collection: 'languages',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(LanguageSchema);

module.exports = mongoose.model('Language', LanguageSchema);