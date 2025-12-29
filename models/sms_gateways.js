const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const GatewaySchema = new Schema(
  {
    name: { 
      type: String, 
      required: true 
    },
    config: { 
      type: Object, 
      required: true 
    },
    enabled: { 
      type: Boolean,
      default: true 
    },
  },
  {
    collection: 'gateways',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(GatewaySchema);

module.exports = mongoose.model('Gateway', GatewaySchema);