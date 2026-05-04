const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FLORA_MCP_URL = 'https://zqlfbaclcyvbfoabyjyp.supabase.co/functions/v1/mcp';
const FLORA_MCP_KEY = process.env.FLORA_MCP_KEY;
const FLORA_SITE_URL = (process.env.FLORA_SITE_URL || 'https://floragayrimenkul.com').replace(/\/$/, '');

const SYSTEM_PROMPT = `Sen Flora Gayrimenkul'un Köyceğiz ofisinden bir emlak danışmanısın. Arkadaşça, samimi ve kısa yaz — sanki telefonda konuşuyormuş gibi. Maksimum 3-4 cümle. Resmi dil kullanma. Fiyatı DM'de söyle, mesajda verme. Her yanıtta ilan linkini ve danışman telefonunu ekle. Türkçe konuş.`;

// ── Flora MCP HTTP helper ─────────────────────────────────────────────────────

async function callFloraRPC(toolName, args = {}) {
  if (!FLORA_MCP_KEY) return null;

  try {
    const { data } = await axios.post(
      FLORA_MCP_URL,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${FLORA_MCP_KEY}` } }
    );

    if (data?.error) {
      console.error(`Flora RPC ${toolName} error:`, data.error);
      return null;
    }

    // MCP returns result wrapped in content[0].text as JSON string
    const raw = data?.result?.content?.[0]?.text ?? data?.result;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return raw; }
    }
    return raw ?? null;
  } catch (err) {
    console.error(`Flora RPC ${toolName} failed:`, err.response?.data ?? err.message);
    return null;
  }
}

// ── Keyword extractor ─────────────────────────────────────────────────────────

function extractFilters(text) {
  const t = text.toLowerCase();

  // type
  const isKiralik = /kiral[iı]k|kira(?!\s*yok)|rent/.test(t);
  const isSatilik = /sat[iı]l[iı]k|sat[iı]\s|buy|purchase/.test(t);
  const type = isKiralik ? 'kiralik' : isSatilik ? 'satilik' : undefined;

  // category
  const isKonut = /daire|ev|konut|villa|m[üu]stakil|apart|residence|oda/.test(t);
  const isArsa  = /arsa|arazi|tarla|parsel|land/.test(t);
  const isTicari = /i[şs]yeri|i[şs] yeri|d[üu]kk[aâ]n|ofis|ticari|commercial|magaza|mağaza/.test(t);
  const category = isKonut ? 'konut' : isArsa ? 'arsa' : isTicari ? 'ticari' : undefined;

  return { type, category };
}

// ── Public helpers ────────────────────────────────────────────────────────────

async function fetchListings(userMessage) {
  const { type, category } = extractFilters(userMessage);
  const args = { limit: 3 };
  if (type)     args.type     = type;
  if (category) args.category = category;

  console.log(`search_listings filters → type:${type ?? '-'} category:${category ?? '-'}`);

  // First try with structured filters; if empty, retry without to get any active listings
  let result = await callFloraRPC('search_listings', args);
  let listings = Array.isArray(result) ? result : [];

  if (!listings.length) {
    console.log('Filtreli arama boş döndü, filtresiz tekrar deneniyor...');
    result = await callFloraRPC('search_listings', { limit: 3 });
    listings = Array.isArray(result) ? result : [];
  }

  console.log(`search_listings → ${listings.length} ilan bulundu`);
  listings.forEach(l => console.log(`  ilan: ${l.slug} | ${l.title} | ${l.price}`));
  return listings;
}

async function fetchAgentPhone() {
  const agents = await callFloraRPC('list_agents', {});
  const phone = Array.isArray(agents) && agents.length ? (agents[0].phone ?? null) : null;
  console.log(`list_agents → danışman telefonu: ${phone ?? 'bulunamadı'}`);
  return phone;
}

// ── Scenario 1: DM reply via Claude ──────────────────────────────────────────

async function generateDMReply(userMessage, listings, agentPhone) {
  const listingLines = listings.length
    ? listings.map(l => {
        const url = `${FLORA_SITE_URL}/ilan/${l.slug}`;
        const price = l.price ? `${Number(l.price).toLocaleString('tr-TR')} ₺` : 'Fiyat için DM';
        return `• ${l.title ?? l.slug} — ${price}\n  ${url}`;
      }).join('\n')
    : 'Şu an eşleşen aktif ilan bulunamadı.';

  const phone = agentPhone ?? 'Danışmanımıza ulaşın';

  const userContent =
    `Kullanıcı mesajı: "${userMessage}"\n\n` +
    `Alakalı ilanlar:\n${listingLines}\n\n` +
    `Danışman telefonu: ${phone}`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 180,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
    return msg.content[0]?.text ?? fallbackDMReply(agentPhone);
  } catch (err) {
    console.error('Claude API error:', err.message);
    return fallbackDMReply(agentPhone);
  }
}

function fallbackDMReply(agentPhone) {
  const phone = agentPhone ? `\n📞 ${agentPhone}` : '';
  return `Merhaba! Flora Gayrimenkul Köyceğiz ekibine ulaştınız. 🌿 Size en kısa sürede dönüş yapacağız.${phone}`;
}

// ── Scenario 2: Comment helpers ───────────────────────────────────────────────

function isPriceQuestion(text) {
  return /fiyat|ücret|ne kadar|kaç para|kaça|tutar|bedel|aylık|kira\s*ne|satış\s*fiyat/i.test(text);
}

// Comment reply when we proactively DM the price
function buildCommentReplySent(agentPhone) {
  const phone = agentPhone ? `\n📞 ${agentPhone}` : '';
  return `DM'den bilgi gönderdik 📩${phone}`;
}

// Comment reply for non-price questions
function buildCommentReply(listingUrl, agentPhone) {
  const link = listingUrl ? `\n🔗 ${listingUrl}` : '';
  const phone = agentPhone ? `\n📞 ${agentPhone}` : '';
  return `Detaylar için buraya göz atabilirsiniz 👇${link}${phone}`;
}

// DM content sent proactively to the commenter
function buildPriceDM(listings, agentPhone, siteUrl) {
  const base = siteUrl.replace(/\/$/, '');
  const phone = agentPhone ? `\n📞 ${agentPhone}` : '';

  if (!listings.length) {
    return `Merhaba! Fiyat bilgisi için sizi danışmanımızla buluşturalım.${phone}`;
  }

  const lines = listings.map(l => {
    const url = `${base}/ilan/${l.slug}`;
    const price = l.price ? `${Number(l.price).toLocaleString('tr-TR')} ₺` : 'Fiyat için arayın';
    return `🏠 ${l.title ?? l.slug}\n💰 ${price}\n🔗 ${url}`;
  }).join('\n\n');

  return `Merhaba! Sorduğunuz ilan hakkında bilgi:\n\n${lines}${phone}`;
}

module.exports = {
  fetchListings,
  fetchAgentPhone,
  generateDMReply,
  isPriceQuestion,
  buildCommentReply,
  buildCommentReplySent,
  buildPriceDM,
};
