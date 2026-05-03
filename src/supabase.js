const axios = require('axios');

const FLORA_MCP_URL = process.env.FLORA_MCP_URL;
const FLORA_MCP_KEY = process.env.FLORA_MCP_KEY;

/**
 * Calls the Flora MCP create_lead tool via JSON-RPC over HTTP.
 *
 * Extracted from the Messenger event:
 *   sender_id  → name ("messenger:<id>") and phone fields
 *   message    → message field (includes ISO timestamp prefix)
 *   timestamp  → prepended to message text (epoch ms from Meta)
 */
async function saveLead({ sender_id, message, raw_event }) {
  if (!FLORA_MCP_URL || !FLORA_MCP_KEY) {
    console.warn('FLORA_MCP_URL or FLORA_MCP_KEY not set – skipping lead save');
    return { data: null, error: new Error('MCP env vars missing') };
  }

  const timestamp = raw_event?.timestamp
    ? new Date(raw_event.timestamp).toISOString()
    : new Date().toISOString();

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'create_lead',
      arguments: {
        name: `messenger:${sender_id}`,
        // phone is required by Flora MCP; use sender_id as unique identifier
        phone: sender_id,
        message: `[${timestamp}] ${message}`,
      },
    },
  };

  try {
    const { data } = await axios.post(FLORA_MCP_URL, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${FLORA_MCP_KEY}`,
      },
    });

    if (data?.error) {
      console.error('Flora MCP create_lead error:', data.error);
      return { data: null, error: data.error };
    }

    console.log(`Lead saved via Flora MCP – sender: ${sender_id}, time: ${timestamp}`);
    return { data: data?.result ?? data, error: null };
  } catch (err) {
    const detail = err.response?.data ?? err.message;
    console.error('Flora MCP request failed:', detail);
    return { data: null, error: detail };
  }
}

module.exports = { saveLead };
