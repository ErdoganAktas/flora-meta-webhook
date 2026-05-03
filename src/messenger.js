const axios = require('axios');

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';

/**
 * Sends a text reply to a Messenger user via the Send API.
 * @param {string} recipientId  – PSID of the recipient
 * @param {string} text         – message text (max 2000 chars)
 */
async function sendReply(recipientId, text) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) {
    console.warn('PAGE_ACCESS_TOKEN not set – skipping reply');
    return;
  }

  try {
    const { data } = await axios.post(
      `${GRAPH_API_BASE}/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: text.slice(0, 2000) },
        messaging_type: 'RESPONSE',
      },
      {
        params: { access_token: token },
        headers: { 'Content-Type': 'application/json' },
      }
    );
    console.log(`Reply sent to ${recipientId}, message_id: ${data.message_id}`);
    return data;
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    console.error('Graph API send error:', detail);
  }
}

module.exports = { sendReply };
