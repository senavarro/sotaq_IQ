const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { email, daily_count, total_xp } = JSON.parse(event.body);
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };

    const normalizedEmail = email.toLowerCase().trim();
    const today = new Date().toISOString().split('T')[0];

    // Fetch current practice_dates
    const { data: current } = await supabase
      .from('user_stats')
      .select('practice_dates')
      .ilike('email', normalizedEmail)
      .single();

    const existing = current?.practice_dates || [];
    const updated = existing.includes(today)
      ? existing
      : [...existing, today].slice(-30); // keep last 30 days max

    const { error } = await supabase
      .from('user_stats')
      .update({ daily_count, total_xp, practice_dates: updated })
      .ilike('email', normalizedEmail);

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
