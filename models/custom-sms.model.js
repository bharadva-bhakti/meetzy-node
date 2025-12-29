const mongoose = require('mongoose');
const { Schema } = mongoose;
const { addVirtualId } = require('../utils/modelHelper');

const SMSGatewaySchema = new Schema(
  {
    name: { 
        type: String, 
        required: true 
    },
    base_url: { 
        type: String, 
        required: true 
    },
    method: { 
        type: String, 
        default: 'POST'
    },
    auth_type: { 
        type: Object, 
        default: null 
    },
    account_sid: { 
        type: String, 
        default: null 
    },
    auth_token: { 
        type: String, 
        default: null 
    },
    from_number: { 
        type: String, 
        default: null 
    },
    custom_config: { 
        type: Object, 
        default: null 
    },
    enabled: { 
        type: Boolean,
        default: true
    },
  },
  {
    collection: 'sms_gateways',
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

addVirtualId(SMSGatewaySchema);

module.exports = mongoose.model('SMSGateway', SMSGatewaySchema);