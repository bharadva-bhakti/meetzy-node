const { SMSGateway } = require('../models');
const { Op } = require('sequelize');
const { loadGateways, sendViaGateway } = require('../services/customSMSService');

exports.getAllGateways = async (req, res) => {
    try {
        const gateways = await SMSGateway.findOne({ order: [['created_at', 'DESC']] });

        res.json({ data: gateways });
    } catch (error) {
        console.error('Error in getAllGateways:', error);
        res.status(500).json({ message: 'Internal server error'});
    }
};

exports.getGatewayById = async (req, res) => {
    try {
        const { id } = req.params;

        const gateway = await SMSGateway.findByPk(id);
        if (!gateway) {
            return res.status(404).json({ message: 'SMS gateway not found'});
        }

        res.json({ data: gateway, message: 'SMS gateway fetched successfully' });
    } catch (error) {
        console.error('Error in getGatewayById:', error);
        res.status(500).json({ message: 'Internal server error'});
    }
};

exports.createGateway = async (req, res) => {
    try {
        const { 
            name, base_url, method = 'POST', auth_type = 'SID_AUTH_TOKEN',
            account_sid, auth_token, from_number, custom_config = {}, enabled = true,
        } = req.body;

        if (!name || !base_url) {
            return res.status(400).json({ message: 'Name and Base URL are required'});
        }

        const existingGateway = await SMSGateway.findOne({ where: { name } });
        if (existingGateway) {
            return res.status(400).json({ message: 'Gateway with this name already exists'});
        }

        const finalCustomConfig = {
            ...custom_config,
            
            body_type: custom_config.body_type || 'form-data',
            body_fields: custom_config.body_fields || [],
            params: custom_config.params || [],
            headers: custom_config.headers || [],
            field_mappings: {
                ...custom_config.field_mappings,
            }
        };

        const gateway = await SMSGateway.create({
            name, base_url, method, auth_type, account_sid, auth_token, from_number,
            custom_config: finalCustomConfig, enabled,
        });
  
        res.status(201).json({ data: gateway, message: 'SMS gateway created successfully'});
    } catch (error) {
        console.error('Error in createGateway:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.updateGateway = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, base_url, method, auth_type, account_sid, 
            auth_token, from_number, custom_config, enabled 
        } = req.body;

        const gateway = await SMSGateway.findByPk(id);
        if (!gateway) {
            return res.status(404).json({ message: 'SMS gateway not found'});
        }

        if (name && name !== gateway.name) {
            const existingGateway = await SMSGateway.findOne({ where: { name } });
            if (existingGateway) {
                return res.status(400).json({ message: 'Gateway with this name already exists'});
            }
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (base_url !== undefined) updateData.base_url = base_url;
        if (method !== undefined) updateData.method = method;
        if (auth_type !== undefined) updateData.auth_type = auth_type;
        if (account_sid !== undefined) updateData.account_sid = account_sid;
        if (auth_token !== undefined) updateData.auth_token = auth_token;
        if (from_number !== undefined) updateData.from_number = from_number;
        if (custom_config !== undefined) updateData.custom_config = custom_config;
        if (enabled !== undefined) updateData.enabled = enabled;

        await gateway.update(updateData);
        await loadGateways();

        res.json({ data: gateway, message: 'SMS gateway updated successfully' });
    } catch (error) {
        console.error('Error updating SMS gateway:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.saveGateway = async (req,res) => {
    try {
        const { 
            name, base_url, method = 'POST', auth_type,
            account_sid, auth_token, from_number, custom_config = {}, enabled = true,
        } = req.body;

        if (!name || !base_url) {
            return res.status(400).json({ message: 'Name and Base URL are required fields' });
        }

        const existingGateway = await SMSGateway.findOne({ order: [['id', 'ASC']] });

        let gateway;
        let isNew = false;

        const finalCustomConfig = {
            body_type: custom_config.body_type || 'form-data',
            body_fields: custom_config.body_fields || [],
            params: custom_config.params || [],
            headers: custom_config.headers || [],
            field_mappings: custom_config.field_mappings || {},
            success_response: custom_config.success_response || { 
                field: 'success', 
                value: true 
            },
            error_response: custom_config.error_response || { 
                field: 'error', 
                value: true 
            }
        };

        if (!existingGateway) {
            const duplicateGateway = await SMSGateway.findOne({ where: { name } });
            if (duplicateGateway) {
                return res.status(400).json({ message: 'Gateway with this name already exists' });
            }

            gateway = await SMSGateway.create({
                name, 
                base_url, 
                method, 
                auth_type, 
                account_sid, 
                auth_token, 
                from_number,
                custom_config: finalCustomConfig, 
                enabled,
            });
            
            isNew = true;
        } else {
            if (name && name !== existingGateway.name) {
                const duplicateGateway = await SMSGateway.findOne({ 
                    where: { 
                        name,
                        id: { [Op.ne]: existingGateway.id } 
                    } 
                });
                if (duplicateGateway) {
                    return res.status(400).json({
                        message: 'Gateway with this name already exists'
                    });
                }
            }

            const updateData = { name, base_url, method, auth_type, account_sid, auth_token, from_number, enabled };
            const existingConfig = existingGateway.custom_config || {};

            updateData.custom_config = {
                ...existingConfig,
                ...custom_config,
                body_type: custom_config.body_type !== undefined ? custom_config.body_type : existingConfig.body_type || 'form-data',
                body_fields: custom_config.body_fields !== undefined ? custom_config.body_fields : existingConfig.body_fields || [],
                params: custom_config.params !== undefined ? custom_config.params : existingConfig.params || [],
                headers: custom_config.headers !== undefined ? custom_config.headers : existingConfig.headers || [],
                field_mappings: custom_config.field_mappings !== undefined 
                    ? { ...existingConfig.field_mappings, ...custom_config.field_mappings }
                    : existingConfig.field_mappings || {},
            };

            await existingGateway.update(updateData);
            gateway = existingGateway;
            isNew = false;
        }

        await loadGateways();

        const responseData = {
            id: gateway.id,
            name: gateway.name,
            base_url: gateway.base_url,
            method: gateway.method,
            auth_type: gateway.auth_type,
            from_number: gateway.from_number,
            custom_config: gateway.custom_config,
            enabled: gateway.enabled,
            created_at: gateway.created_at,
            updated_at: gateway.updated_at
        };

        res.status(isNew ? 201 : 200).json({ 
            data: responseData, 
            message: isNew ? 'SMS gateway created successfully' : 'SMS gateway updated successfully',
            action: isNew ? 'created' : 'updated'
        });
    } catch (error) {
        console.error('Error in saveGateway:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.deleteGateway = async (req, res) => {
    try {
        const { id } = req.params;

        const gateway = await SMSGateway.findByPk(id);
        if (!gateway) {
            return res.status(404).json({ message: 'SMS gateway not found'});
        }

        await gateway.destroy();
        await loadGateways();

        res.json({ message: 'SMS gateway deleted successfully'});
    } catch (error) {
        console.error('Error deleting SMS gateway:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.toggleGateway = async (req, res) => {
    try {
        const gateway = await SMSGateway.findOne({ order: [['id', 'ASC']] });
        if (!gateway) {
            return res.status(404).json({ message: 'No SMS gateway defined yet.'});
        }

        await gateway.update({ enabled: !gateway.enabled });
        await loadGateways();

        res.json({
            data: gateway,
            message: `SMS gateway ${gateway.enabled ? 'enabled' : 'disabled'} successfully`
        });
    } catch (error) {
        console.error('Error toggling SMS gateway:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

exports.testGateway = async (req, res) => {
    try {
        const { test_phone } = req.body;
        let test_message = req.body
        
        if(!test_message){
            test_message = 'Test SMS from gateway';
        }
        const gateway = await SMSGateway.findOne({ order: [['id', 'ASC']] });
        if (!gateway) {
            return res.status(404).json({ message: 'No SMS gateway defined yet.'});
        }

        if (!gateway.enabled) {
            return res.status(400).json({ message: 'Gateway is disabled. Please enable it first.'});
        }

        try {
            const result = await sendViaGateway(gateway, test_phone, test_message);
            
            res.json({ data: result, message: 'Test SMS sent successfully'});
        } catch (error) {
            console.log('Test SMS Failed', error);  
            res.status(400).json({ message: 'Test SMS failed', error: error.message + ' ' +  error.response?.data?.message});
        }
    } catch (error) {
        console.error('Error testing SMS gateway:', error);
        res.status(500).json({ message: 'Internal server error'});
    }
};