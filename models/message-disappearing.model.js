const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const MessageDisappearingSchema = new Schema(
  {
    message_id: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
      unique: true,
    },
    enabled: { 
      type: Boolean, 
      default: true 
    },
    expire_after_seconds: { 
      type: Number, 
      default: null 
    },
    expire_at: { 
      type: Date, 
      default: null 
    },
    metadata: { 
      type: Object, 
      default: null 
    },
  },
  {
    collection: 'message_disappearings',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(MessageDisappearingSchema);

module.exports = mongoose.model('MessageDisappearing', MessageDisappearingSchema);