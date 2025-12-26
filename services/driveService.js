'use strict';

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { google } = require('googleapis');
const getOAuthClient = require('../config/googleAuth');
const { GoogleToken } = require('../models');

async function getAuthClientForUser(userId) {
    const token = await GoogleToken.findOne({ where: { user_id: userId }});
    if(!token) throw new Error('User is not connected to Google drive.');
    
    const oAuth2Client = getOAuthClient();
    oAuth2Client.setCredentials({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expiry_date: token.expiry_date,
    });

    return oAuth2Client;
};

async function uploadFileToDrive(userId, filePath) {
    const auth = await getAuthClientForUser(userId);
    const drive = google.drive({ version: 'v3', auth});
    
    const fileName = path.basename(filePath);
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    const requestBody = { name: fileName };

    const media = { mimeType: mimeType, body: fs.createReadStream(filePath) };
    const res = await drive.files.create({ requestBody, media, fields: 'id' });

    return res.data.id;
};

module.exports = { uploadFileToDrive };