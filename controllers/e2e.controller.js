const { User, Setting } = require('../models');
const { encryptPrivateKey, decryptPrivateKey } = require('../utils/keyEncryption');

const isE2EEnabled = async () => {
    const setting = await Setting.findOne({ attributes: ['e2e_encryption_enabled'], raw:true });
    
    return setting?.e2e_encryption_enabled || false;
};

exports.savePublicKey = async (req,res) => {
    try {
        const userId = req.user.id;
        const { public_key, private_key } = req.body;
    
        if (!await isE2EEnabled()) {
          return res.status(403).json({ message: 'E2E encryption is not enabled'});
        }
    
        if (!public_key) {
          return res.status(400).json({ message: 'public_key is required' });
        }

        const updateData = { public_key };
        if (private_key) {
          updateData.private_key = encryptPrivateKey(private_key);
        }
    
        await User.update(updateData, { where: { id: userId } });
    
        return res.status(200).json({ message: 'Keys saved successfully',});
    } catch (error) {
        console.error('Error in savePublicKey:', error);
        return res.status(500).json({message: 'Internal Server Error'});
    }
};

exports.getPublicKey = async (req,res) => {
    try {
        const { user_id } = req.params;
        const currentUserId = req.user?.id;
        const e2eEnabled = await isE2EEnabled();
        if(!e2eEnabled && currentUserId && Number(user_id) !== currentUserId){}

        const attributes = currentUserId && Number(user_id) === currentUserId
          ? ['id', 'name', 'email', 'avatar', 'public_key', 'private_key']
          : ['id', 'name', 'email', 'avatar', 'public_key'];

        const user = await User.findByPk(user_id, {
            attributes: attributes
        });
        if(!user) return res.status(400).json({message: 'User not found.'});
    
        let decryptedPrivateKey = null;
        if (currentUserId && Number(user_id) === currentUserId && user.private_key) {
          decryptedPrivateKey = decryptPrivateKey(user.private_key);
        }
    
        return res.status(200).json({
            id:user.id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            public_key: user.public_key,
            private_key: decryptedPrivateKey,
            has_encryption: !!user.public_key,
            e2e_enabled: e2eEnabled,
        });
    } catch (error) {
        console.error('Error in getPublicKey:', error);
        return res.status(500).json({ message: 'Internal Server Error.'});
    }
};

exports.deletePublicKey = async (req,res) => {
    const userId = req.user.id;

    try {
        await User.update({ public_key: null, private_key: null }, { where: { id: userId } });
      
        return res.status(200).json({message: 'Keys deleted successfully'});
    } catch (error) {
        console.error('Error in deletePublicKey:', error);
        return res.status(500).json({ message: 'Internal Server Error.'});
    }
};