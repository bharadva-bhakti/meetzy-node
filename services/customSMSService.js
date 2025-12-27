const axios = require('axios');
const { db } = require('../models');
const SMSGateway = db.SMSGateway;

let gatewayCache = null;
let lastLoadTime = null;
const CACHE_TTL = 5 * 60 * 1000;

const loadGateway = async () => {
  try {
    const gateway = await SMSGateway.findOne({ enabled: true }).sort({ created_at: -1 }).lean();

    gatewayCache = gateway;
    lastLoadTime = Date.now();

    console.log(gateway ? `Loaded custom SMS gateway: ${gateway.name}` : 'No enabled custom SMS gateway found');
    return gateway;
  } catch (error) {
    console.error('Error loading custom SMS gateway:', error);
    return null;
  }
};

const getGateway = async () => {
  if (!gatewayCache || (Date.now() - lastLoadTime > CACHE_TTL)) {
    await loadGateway();
  }
  return gatewayCache;
};

const buildHeaders = (gateway) => {
  const headers = {};
  const customConfig = gateway.custom_config || {};

  if (gateway.account_sid && gateway.auth_token) {
    headers.Authorization = `Basic ${Buffer
      .from(`${gateway.account_sid}:${gateway.auth_token}`)
      .toString('base64')}`;
  }

  if (customConfig.headers?.length) {
    customConfig.headers.forEach(h => {
      if (h.key && h.value) headers[h.key] = h.value;
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

    if (customConfig.body_fields) {
      customConfig.body_fields.forEach((field) => {
        if (field.key) body[field.key] = field.value;
      });
    }

    return body;
  }

  const formData = new URLSearchParams();

  formData.append(fieldMappings.to_field || 'To', to);
  formData.append(fieldMappings.message_field || 'Body', message);
  formData.append(fieldMappings.from_field || 'From', gateway.from_number);

  if (customConfig.body_fields) {
    customConfig.body_fields.forEach((field) => {
      if (field.key) formData.append(field.key, field.value);
    });
  }

  return formData;
};

const buildRequestConfig = (gateway, to, message) => {
  const headers = buildHeaders(gateway);
  const data = buildBody(gateway, to, message);

  const isFormData = data instanceof URLSearchParams;

  return {
    method: gateway.method || 'POST',
    url: gateway.base_url,
    headers: {
      ...headers,
      ...(isFormData ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {
        'Content-Type': 'application/json'
      }),
      Accept: 'application/json'
    },
    data: isFormData ? data.toString() : data,
    timeout: 10000,
  };
};

const sendViaGateway = async (gateway, to, message) => {
  const config = buildRequestConfig(gateway, to, message);
  const response = await axios(config);

  return {
    success: true,
    messageId: response.data.sid || response.data.message_id || `msg-${Date.now()}`,
    gateway: gateway.name,
  };
};

const sendSMS = async (to, message) => {
  const gateway = await getGateway();

  if (!gateway) {
    throw new Error('No enabled custom SMS gateway configured');
  }

  try {
    console.log(`Sending SMS via custom gateway: ${gateway.name}`);
    const result = await sendViaGateway(gateway, to, message);
    console.log(`SMS sent successfully via ${gateway.name}`);
    return result;
  } catch (error) {
    console.error(`Custom SMS failed via ${gateway.name}:`, error.response?.data || error.message);
    throw new Error('SMS sending failed');
  }
};

const refreshGateways = async () => {
  gatewayCache = null;
  lastLoadTime = null;
  await loadGateway();
};

module.exports = {
  sendSMS,
  sendViaGateway,
  refreshGateways,
  loadGateway,
};