const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { email } = JSON.parse(event.body);
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };

    const normalizedEmail = email.toLowerCase().trim();

    await supabase.from('score_feedback').delete().ilike('email', normalizedEmail);
    await supabase.from('user_stats').delete().ilike('email', normalizedEmail);
    await supabase.from('allowed_users').delete().ilike('email', normalizedEmail);

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
