const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const GoogleTokenSchema = new Schema(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    google_email: { 
      type: String, 
      default: null 
    },
    access_token: { 
      type: String, 
      required: true
    },
    refresh_token: { 
      type: String, 
      required: true
    },
    expiry_date: { 
      type: Number, 
      default: null 
    },
  },
  {
    collection: 'google_tokens',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(GoogleTokenSchema);

module.exports = mongoose.model('GoogleToken', GoogleTokenSchema);