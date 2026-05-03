const express = require('express');
const crypto = require('crypto');
const { saveLead } = require('./supabase');
const { sendReply } = require('./messenger');

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

// ── POST /webhook ─ Incoming messages ────────────────────────────────────────
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
    for (const event of entry.messaging ?? []) {
      await handleMessagingEvent(event);
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function verifySignature(req) {
  if (!APP_SECRET) return true; // skip in dev when secret not set

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function handleMessagingEvent(event) {
  const senderId = event.sender?.id;
  if (!senderId) return;

  // Message received
  if (event.message && !event.message.is_echo) {
    const text = event.message.text ?? '';
    console.log(`Message from ${senderId}: ${text}`);

    await saveLead({
      platform: 'messenger',
      sender_id: senderId,
      message: text,
      raw_event: event,
    });

    await sendReply(senderId, buildReply(text));
  }

  // Postback (button tap)
  if (event.postback) {
    const payload = event.postback.payload ?? '';
    console.log(`Postback from ${senderId}: ${payload}`);

    await saveLead({
      platform: 'messenger',
      sender_id: senderId,
      message: `[postback] ${payload}`,
      raw_event: event,
    });

    await sendReply(senderId, buildReply(payload));
  }
}

function buildReply(incomingText) {
  const greeting = 'Merhaba! Flora ekibine ulaştınız. 🌿';
  const closing = 'En kısa sürede size geri döneceğiz.';
  return incomingText
    ? `${greeting} Mesajınızı aldık. ${closing}`
    : `${greeting} ${closing}`;
}

module.exports = router;
