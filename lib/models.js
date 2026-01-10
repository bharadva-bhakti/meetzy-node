/**
 * User Model Synchronization Module
 * Handles syncing with existing user models in the host project
 */

const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

let sequelize = null;
let User = null;
let hostUserModel = null;

/**
 * User Model class that can sync with existing models
 */
class UserModel {
  constructor(sequelizeInstance, options = {}) {
    this.sequelize = sequelizeInstance;
    this.options = {
      tableName: 'users',
      timestamps: true,
      ...options
    };
    
    this.defineModel();
  }

  defineModel() {
    this.model = this.sequelize.define('User', {
      id: { 
        type: DataTypes.INTEGER.UNSIGNED, 
        autoIncrement: true, 
        primaryKey: true 
      },
      name: { 
        type: DataTypes.STRING(255), 
        allowNull: false 
      },
      email: { 
        type: DataTypes.STRING(255), 
        allowNull: false, 
        unique: true 
      },
      password: { 
        type: DataTypes.STRING(255), 
        allowNull: false 
      },
      email_verified_at: { 
        type: DataTypes.DATE, 
        allowNull: true 
      },
      system_reserve: { 
        type: DataTypes.BOOLEAN, 
        allowNull: false, 
        defaultValue: true 
      }
    }, { 
      tableName: this.options.tableName, 
      timestamps: this.options.timestamps 
    });
  }

  /**
   * Get the Sequelize model
   * @returns {Sequelize.Model} The User model
   */
  getModel() {
    return this.model;
  }

  /**
   * Sync the model with database
   * @returns {Promise<void>}
   */
  async sync() {
    await this.model.sync();
  }

  /**
   * Create or update admin user
   * @param {Object} adminData - Admin user data
   * @returns {Promise<Sequelize.Model>} Created or updated user
   */
  async createOrUpdateAdmin(adminData) {
    const name = `${adminData.first_name} ${adminData.last_name}`.trim();
    const email = adminData.email;
    const password = await bcrypt.hash(adminData.password, 10);
    
    const existing = await this.model.findOne({ where: { email } });
    if (existing) {
      await existing.update({ 
        name, 
        password, 
        email_verified_at: new Date(), 
        system_reserve: true 
      });
      return existing;
    }
    
    return await this.model.create({ 
      name, 
      email, 
      password, 
      email_verified_at: new Date(), 
      system_reserve: true 
    });
  }
}

/**
 * Sync with existing user model from host project
 * @param {Sequelize} sequelizeInstance - Sequelize instance
 * @param {Object} existingUserModel - Existing user model from host project
 * @param {Object} options - Configuration options
 * @returns {Promise<UserModel>} Synchronized user model
 */
async function syncUserModel(sequelizeInstance, existingUserModel = null, options = {}) {
  if (existingUserModel) {
    // Use existing user model and add system_reserve field if it doesn't exist
    hostUserModel = existingUserModel;
    
    // Check if system_reserve field exists, if not add it
    const tableDescription = await sequelizeInstance.getQueryInterface().describeTable(existingUserModel.tableName);
    if (!tableDescription.system_reserve) {
      await sequelizeInstance.getQueryInterface().addColumn(
        existingUserModel.tableName, 
        'system_reserve', 
        {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true
        }
      );
    }
    
    // Create wrapper methods for admin operations
    const userModel = new UserModel(sequelizeInstance, options);
    userModel.model = existingUserModel;
    
    // Override createOrUpdateAdmin to work with existing model
    userModel.createOrUpdateAdmin = async (adminData) => {
      const name = `${adminData.first_name} ${adminData.last_name}`.trim();
      const email = adminData.email;
      const password = await bcrypt.hash(adminData.password, 10);
      
      const existing = await existingUserModel.findOne({ where: { email } });
      if (existing) {
        await existing.update({ 
          name, 
          password, 
          email_verified_at: new Date(), 
          system_reserve: true 
        });
        return existing;
      }
      
      return await existingUserModel.create({ 
        name, 
        email, 
        password, 
        email_verified_at: new Date(), 
        system_reserve: true 
      });
    };
    
    return userModel;
  } else {
    // Create new user model
    return new UserModel(sequelizeInstance, options);
  }
}

/**
 * Check if user model exists and has required fields
 * @param {Sequelize.Model} userModel - User model to check
 * @returns {Promise<Object>} Model compatibility info
 */
async function checkUserModelCompatibility(userModel) {
  if (!userModel) {
    return { compatible: false, reason: 'No user model provided' };
  }

  // Basic compatibility check without database connection
  const requiredFields = ['id', 'name', 'email', 'password'];
  const requiredMethods = ['findOne', 'create', 'update'];
  
  // Check if user model has required structure
  const hasTableName = !!userModel.tableName;
  const hasRequiredMethods = requiredMethods.every(method => typeof userModel[method] === 'function');
  
  if (!hasTableName) {
    return { 
      compatible: false, 
      reason: 'User model must have a tableName property',
      missingFields: ['tableName']
    };
  }
  
  if (!hasRequiredMethods) {
    const missingMethods = requiredMethods.filter(method => typeof userModel[method] !== 'function');
    return { 
      compatible: false, 
      reason: `Missing required methods: ${missingMethods.join(', ')}`,
      missingMethods
    };
  }

  // If we have a database connection, do a more detailed check
  if (userModel.sequelize && userModel.sequelize.getQueryInterface) {
    try {
      const tableDescription = await userModel.sequelize.getQueryInterface().describeTable(userModel.tableName);
      const missingFields = requiredFields.filter(field => !tableDescription[field]);
      
      if (missingFields.length > 0) {
        return { 
          compatible: false, 
          reason: `Missing required fields: ${missingFields.join(', ')}`,
          missingFields 
        };
      }

      return { 
        compatible: true, 
        hasSystemReserve: !!tableDescription.system_reserve,
        fields: Object.keys(tableDescription),
        detailedCheck: true
      };
    } catch (error) {
      // Database not accessible, but basic structure is OK
      return { 
        compatible: true, 
        hasSystemReserve: false,
        fields: requiredFields,
        detailedCheck: false,
        note: 'Database not accessible, but basic structure is compatible'
      };
    }
  }

  // No database connection, but basic structure is compatible
  return { 
    compatible: true, 
    hasSystemReserve: false,
    fields: requiredFields,
    detailedCheck: false,
    note: 'Basic structure check passed - detailed check will happen during installation'
  };
}

module.exports = {
  UserModel,
  syncUserModel,
  checkUserModelCompatibility
};