const { db } = require('../models');
const User = db.User;
const Setting = db.Setting;
const { encryptPrivateKey, decryptPrivateKey } = require('../utils/keyEncryption');

const isE2EEnabled = async () => {
  const setting = await Setting.findOne().select('e2e_encryption_enabled').lean();
  return setting?.e2e_encryption_enabled || false;
};

exports.savePublicKey = async (req, res) => {
  try {
    const userId = req.user._id;
    const { public_key, private_key } = req.body;

    if (!(await isE2EEnabled())) {
      return res.status(403).json({ message: 'E2E encryption is not enabled' });
    }

    if (!public_key) return res.status(400).json({ message: 'public_key is required' });

    const updateData = { public_key };
    if (private_key) {
      updateData.private_key = encryptPrivateKey(private_key);
    }

    await User.updateOne({ _id: userId }, { $set: updateData });

    return res.status(200).json({ message: 'Keys saved successfully' });
  } catch (error) {
    console.error('Error in savePublicKey:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};

exports.getPublicKey = async (req, res) => {
    try {
      const { user_id } = req.params;
      const currentUserId = req.user?._id?.toString();
      const e2eEnabled = await isE2EEnabled();
  
      if (!e2eEnabled && currentUserId && user_id !== currentUserId) {
        return res.status(403).json({ message: 'E2E encryption is not enabled' });
      }
  
      const selectFields = currentUserId === user_id
        ? 'id name email avatar public_key private_key' : 'id name email avatar public_key';
  
      const user = await User.findById(user_id).select(selectFields).lean({ virtuals: true });
      if (!user) return res.status(404).json({ message: 'User not found.' });
  
      let decryptedPrivateKey = null;
      if (currentUserId === user_id && user.private_key) {
        decryptedPrivateKey = decryptPrivateKey(user.private_key);
      }
  
      return res.status(200).json({
        id: user._id,
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
      return res.status(500).json({ message: 'Internal Server Error' });
    }
};

exports.deletePublicKey = async (req, res) => {
  const userId = req.user._id;

  try {
    await User.updateOne({ _id: userId },{ $set: { public_key: null, private_key: null } });

    return res.status(200).json({ message: 'Keys deleted successfully' });
  } catch (error) {
    console.error('Error in deletePublicKey:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
};