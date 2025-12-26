const axios = require('axios');
const { SMSGateway } = require('../models');

let gateways = null;

const loadGateways = async () => {
  try {
    gateways = await SMSGateway.findOne({
      where: { enabled: true },
      order: [['created_at', 'DESC']]
    });
    
    console.log(gateways ? `Loaded gateway: ${gateways.name}` : 'No SMS gateway found');
  } catch (error) {
    console.error('Error loading SMS gateways:', error);
  }
};

const buildHeaders = (gateway) => {
  const headers = {};
  const customConfig = gateway.custom_config || {};
  const auth = gateway.auth_type;

  const hasSID = Array.isArray(auth) ? auth.includes('SID') : auth === 'SID';
  const hasAuthToken = Array.isArray(auth) ? auth.includes('AUTH_TOKEN') : auth === 'AUTH_TOKEN';
  const hasCustomKeys = Array.isArray(auth) ? auth.includes('CUSTOM_KEYS') : auth === 'CUSTOM_KEYS';

  if (hasSID && hasAuthToken) {
    const authString = Buffer.from(`${gateway.account_sid}:${gateway.auth_token}`).toString('base64');
    headers['Authorization'] = `Basic ${authString}`;
  }

  if (hasCustomKeys) {
    (customConfig.headers || []).forEach(header => {
      headers[header.key] = header.value;
    });
  }

  return headers;
};

const buildBody = (gateway, to, message) => {
  const customConfig = gateway.custom_config || {};
  const bodyType = customConfig.body_type || 'form-data';
  const fieldMappings = customConfig.field_mappings || {};

  if (bodyType === 'json') {
    const body = {};
    
    body[fieldMappings.to_field || 'To'] = to;
    body[fieldMappings.message_field || 'Body'] = message;
    body[fieldMappings.from_field || 'From'] = gateway.from_number;
    
    (customConfig.body_fields || []).forEach(field => {
      body[field.key] = field.value;
    });

    return body;
    
  } else {
    const formData = new URLSearchParams();
    
    formData.append(fieldMappings.to_field || 'To', to);
    formData.append(fieldMappings.message_field || 'Body', message);
    formData.append(fieldMappings.from_field || 'From', gateway.from_number);
    
    (customConfig.body_fields || []).forEach(field => {
      formData.append(field.key, field.value);
    });

    return formData.toString();
  }
};

const buildRequestConfig = (gateway, to, message) => {
  const config = {
    method: gateway.method,
    url: gateway.base_url,
    timeout: 10000
  };

  config.headers = buildHeaders(gateway);

  config.data = buildBody(gateway, to, message);

  return config;
};

const sendViaGateway = async (gateway, to, message) => {
  const config = buildRequestConfig(gateway, to, message);
  const response = await axios(config);
  
  return { 
    success: true, 
    messageId: response.data.sid || `msg-${Date.now()}`,
    gateway: gateway.name 
  };
};

const sendSMS = async (to, message) => {
  if (!gateways) {
    await loadGateways();
  }

  const gateway = gateways;

  if (!gateway) {
    throw new Error('No SMS gateway configured');
  }

  try {
    console.log(`Attempting to send SMS via ${gateway.name}`);
    const result = await sendViaGateway(gateway, to, message);
    console.log(`SMS sent successfully via ${gateway.name}`);
    return result;
  } catch (error) {
    console.error(`SMS failed via ${gateway.name}:`, error.message);
    throw new Error('SMS sending failed');
  }
};

const refreshGateways = async () => {
  gateways = [];
  await loadGateways();
};

module.exports = {
  sendSMS,
  sendViaGateway,
  refreshGateways,
  loadGateways
};