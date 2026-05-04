const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { saveLead } = require('./supabase');
const { sendReply } = require('./messenger');
const {
  fetchListings,
  fetchAgentPhone,
  generateDMReply,
  isPriceQuestion,
  buildCommentReply,
  buildCommentReplySent,
  buildPriceDM,
} = require('./claude');

const router = express.Router();

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;

// ── GET /webhook ─ Meta challenge verification ────────────────────────────────
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  console.warn('Webhook verification failed – token mismatch');
  return res.sendStatus(403);
});

// ── POST /webhook ─ Incoming events ──────────────────────────────────────────
router.post('/', async (req, res) => {
  // Always respond 200 immediately so Meta doesn't retry
  res.sendStatus(200);

  if (!verifySignature(req)) {
    console.warn('Invalid X-Hub-Signature-256 – payload discarded');
    return;
  }

  const body = req.body;
  if (body.object !== 'page') return;

  for (const entry of body.entry ?? []) {
    // Scenario 1: Messenger DM
    for (const event of entry.messaging ?? []) {
      await handleDMEvent(event);
    }

    // Scenario 2: Facebook page feed comment
    for (const change of entry.changes ?? []) {
      if (change.field === 'feed' && change.value?.item === 'comment') {
        await handleCommentEvent(change.value);
      }
    }
  }
});

// ── Scenario 1: Messenger DM ──────────────────────────────────────────────────

async function handleDMEvent(event) {
  const senderId = event.sender?.id;
  if (!senderId) return;

  const text =
    event.message && !event.message.is_echo
      ? event.message.text ?? ''
      : event.postback
        ? event.postback.payload ?? ''
        : null;

  if (text === null) return;

  const label = event.postback ? '[postback] ' : '';
  console.log(`DM from ${senderId}: ${label}${text}`);

  // Save lead and fetch listings + agent in parallel (non-blocking on failure)
  const [, listings, agentPhone] = await Promise.all([
    saveLead({ sender_id: senderId, message: `${label}${text}`, raw_event: event }),
    fetchListings(text),
    fetchAgentPhone(),
  ]);

  const reply = await generateDMReply(text, listings, agentPhone);
  await sendReply(senderId, reply);
}

// ── Scenario 2: Facebook Comment ─────────────────────────────────────────────

async function handleCommentEvent(value) {
  const commentId = value.comment_id;
  const message = value.message ?? '';
  const senderId = value.from?.id;

  console.log(`Comment ${commentId} from ${senderId}: ${message}`);

  const [, listings, agentPhone] = await Promise.all([
    senderId
      ? saveLead({ sender_id: senderId, message: `[comment] ${message}`, raw_event: value })
      : Promise.resolve(),
    fetchListings(message),
    fetchAgentPhone(),
  ]);

  const FLORA_SITE_URL = (process.env.FLORA_SITE_URL || 'https://floragayrimenkul.com').replace(/\/$/, '');

  if (isPriceQuestion(message) && senderId) {
    // Send price + listing URL via DM, then acknowledge on comment
    const dm = buildPriceDM(listings, agentPhone, FLORA_SITE_URL);
    await sendReply(senderId, dm);
    console.log(`Price DM sent to ${senderId}`);
    await postCommentReply(commentId, buildCommentReplySent(agentPhone));
  } else {
    // Non-price comment: reply publicly with listing URL + phone
    const listingUrl = listings.length
      ? `${FLORA_SITE_URL}/ilan/${listings[0].slug}`
      : `${FLORA_SITE_URL}/ilanlar`;
    await postCommentReply(commentId, buildCommentReply(listingUrl, agentPhone));
  }
}

async function postCommentReply(commentId, text) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) {
    console.warn('PAGE_ACCESS_TOKEN not set – skipping comment reply');
    return;
  }

  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v18.0/${commentId}/comments`,
      { message: text },
      { params: { access_token: token } }
    );
    console.log(`Comment reply posted: ${data.id}`);
    return data;
  } catch (err) {
    console.error('Comment reply error:', err.response?.data ?? err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function verifySignature(req) {
  if (!APP_SECRET) return true;

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = router;
