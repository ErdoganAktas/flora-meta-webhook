const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/**
 * Inserts a new lead row into the `messenger_leads` table.
 *
 * Expected table schema:
 *   id          uuid primary key default gen_random_uuid()
 *   platform    text
 *   sender_id   text
 *   message     text
 *   raw_event   jsonb
 *   created_at  timestamptz default now()
 */
async function saveLead({ platform, sender_id, message, raw_event }) {
  const { data, error } = await supabase.from('messenger_leads').insert({
    platform,
    sender_id,
    message,
    raw_event,
  });

  if (error) {
    console.error('Supabase insert error:', error.message);
  } else {
    console.log('Lead saved:', sender_id);
  }

  return { data, error };
}

module.exports = { supabase, saveLead };
