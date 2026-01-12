const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

/**
 * Reloads environment variables from .env file
 */
function reloadEnvVariables() {
  try {
    // Parse the .env file and assign to process.env
    const envConfig = dotenv.parse(fs.readFileSync('.env'));
    
    // Update process.env with new values
    for (const key in envConfig) {
      process.env[key] = envConfig[key];
    }
    
    console.log('Environment variables reloaded from .env file');
    return true;
  } catch (error) {
    console.error('Error reloading environment variables:', error);
    return false;
  }
}

/**
 * Disconnects and reconnects to MongoDB with new environment variables
 */
async function reconnectDB() {
  try {
    // Disconnect existing connections
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB');
    }
    
    // Reload environment variables to get updated MONGODB_URI
    reloadEnvVariables();
    
    // Connect with new URI
    const mongoUri = process.env.MONGODB_URI;
    
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment variables');
    }
    
    await mongoose.connect(mongoUri);
    
    console.log('Reconnected to MongoDB successfully with new configuration');
    
    return { success: true, message: 'Database reconnected successfully' };
  } catch (error) {
    console.error('Error reconnecting to database:', error);
    return { success: false, message: 'Failed to reconnect to database', error: error.message };
  }
}

/**
 * Updates environment variables in .env file and reconnects database
 * @param {Object} envUpdates - Object containing environment variable updates
 */
async function updateEnvAndReconnect(envUpdates) {
  try {
    // Read current .env file
    let envContent = '';
    try {
      envContent = fs.readFileSync('.env', 'utf8');
    } catch (error) {
      // If .env file doesn't exist, start with empty content
      envContent = '';
    }

    // Update the environment variables in the content
    let updatedContent = envContent;
    for (const [key, value] of Object.entries(envUpdates)) {
      // Check if the variable already exists in the file
      const regex = new RegExp(`^${key}\\s*=\\s*.*$`, 'm');
      
      if (regex.test(updatedContent)) {
        // Replace existing variable
        updatedContent = updatedContent.replace(regex, `${key}=${value}`);
      } else {
        // Add new variable
        if (updatedContent && !updatedContent.endsWith('\n')) {
          updatedContent += '\n';
        }
        updatedContent += `${key}=${value}\n`;
      }
    }

    // Write the updated content back to the file
    fs.writeFileSync('.env', updatedContent);
    console.log('Environment variables updated in .env file');

    // Reconnect to database with new configuration
    return await reconnectDB();
  } catch (error) {
    console.error('Error updating environment and reconnecting:', error);
    return { success: false, message: 'Failed to update environment and reconnect', error: error.message };
  }
}

module.exports = {
  reloadEnvVariables,
  reconnectDB,
  updateEnvAndReconnect
};
