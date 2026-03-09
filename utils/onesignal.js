require('dotenv').config();
const axios = require('axios');

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const ONESIGNAL_API_URL = 'https://onesignal.com/api/v1/notifications';

async function sendToAll(title, message, additionalData = {}) {
    try {
        const payload = {
            app_id: ONESIGNAL_APP_ID,
            included_segments: ['All'],
            headings: { en: title },
            contents: { en: message },
        };

        if (Object.keys(additionalData).length > 0) {
            payload.data = additionalData;
        }

        const response = await axios.post(ONESIGNAL_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
            }
        });

        console.log('✓ Notification sent to all users');
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        console.error('✗ Error sending notification to all:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

async function sendToUsers(playerIds, title, message, additionalData = {}) {
    console.log("🚀 ~ sendToUsers ~ playerIds:", playerIds)
    try {
        if (!Array.isArray(playerIds) || playerIds.length === 0) {
            throw new Error('playerIds must be a non-empty array');
        }

        const payload = {
            app_id: ONESIGNAL_APP_ID,
            include_player_ids: playerIds,
            headings: { en: title },
            contents: { en: message },
        };
        console.log("🚀 ~ sendToUsers ~ payload:", payload)

        if (Object.keys(additionalData).length > 0) {
            payload.data = additionalData;
        }

        const response = await axios.post(ONESIGNAL_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
            }
        });
        console.log("🚀 ~ sendToUsers ~ response:", response)

        console.log(`✓ Notification sent to ${playerIds.length} user(s)`);
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        console.error('✗ Error sending notification to users:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

async function sendToSegment(segments, title, message, additionalData = {}) {
    try {
        const payload = {
            app_id: ONESIGNAL_APP_ID,
            included_segments: segments,
            headings: { en: title },
            contents: { en: message },
        };

        if (Object.keys(additionalData).length > 0) {
            payload.data = additionalData;
        }

        const response = await axios.post(ONESIGNAL_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
            }
        });

        console.log(`✓ Notification sent to segment: ${segments.join(', ')}`);
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        console.error('✗ Error sending notification to segment:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

async function sendWithImage(title, message, imageUrl, target = 'All', additionalData = {}) {
    try {
        const payload = {
            app_id: ONESIGNAL_APP_ID,
            headings: { en: title },
            contents: { en: message },
            big_picture: imageUrl,
            ios_attachments: { id: imageUrl },
        };

        if (target === 'All') {
            payload.included_segments = ['All'];
        } else if (Array.isArray(target)) {
            payload.include_player_ids = target;
        }

        if (Object.keys(additionalData).length > 0) {
            payload.data = additionalData;
        }

        const response = await axios.post(ONESIGNAL_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
            }
        });

        console.log('✓ Notification with image sent successfully');
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        console.error('✗ Error sending notification with image:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

async function sendScheduled(title, message, scheduleTime, target = 'All') {
    try {
        const payload = {
            app_id: ONESIGNAL_APP_ID,
            headings: { en: title },
            contents: { en: message },
            send_after: scheduleTime instanceof Date ? scheduleTime.toISOString() : scheduleTime,
        };

        if (target === 'All') {
            payload.included_segments = ['All'];
        } else if (Array.isArray(target)) {
            payload.include_player_ids = target;
        }

        const response = await axios.post(ONESIGNAL_API_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
            }
        });

        console.log('✓ Scheduled notification created');
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        console.error('✗ Error creating scheduled notification:', error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}

module.exports = {
    sendToAll,
    sendToUsers,
    sendToSegment,
    sendWithImage,
    sendScheduled
};
