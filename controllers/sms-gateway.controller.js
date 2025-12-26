const { Gateway } = require('../models');

exports.getGateways = async (req, res) => {
  try {
    const gateways = await Gateway.findAll({ order: [['id', 'DESC']]});

    return res.status(200).json(gateways);

  } catch (error) {
    console.error('Get Gateways Error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
  
exports.createGateway = async (req, res) => {
  try {
    const { name, config, enabled = true } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Gateway name is required' });
    }
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ message: 'Config must be a JSON object' });
    }

    const exists = await Gateway.findOne({ where: { name } });
    if (exists) {
      return res.status(409).json({ message: 'Gateway with this name already exists' });
    }

    const gateway = await Gateway.create({ name, config, enabled});

    return res.status(201).json({ message: 'SMS Gateway created successfully', gateway });
  } catch (error) {
    console.error('Create Gateway Error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

exports.updateGateway = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, config, enabled } = req.body;

    const gateway = await Gateway.findByPk(id);
    if (!gateway) {
      return res.status(404).json({ message: 'SMS Gateway not found' });
    }

    if (name) gateway.name = name;
    if (config && typeof config === 'object') gateway.config = config;
    if (typeof enabled === 'boolean') gateway.enabled = enabled;

    await gateway.save();

    return res.status(200).json({ message: 'SMS Gateway updated successfully', gateway });
  } catch (error) {
    console.error('Update Gateway Error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
  
exports.changeGatewayStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'Enabled must be true or false' });
    }

    const gateway = await Gateway.findByPk(id);
    if (!gateway) {
      return res.status(404).json({ message: 'SMS Gateway not found' });
    }

    gateway.enabled = enabled;
    await gateway.save();

    const msg = enabled ? 'enabled' : 'disabled';

    return res.status(200).json({ message: `Gateway ${msg} successfully`, gateway });

  } catch (error) {
    console.error('Change Status Error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
    