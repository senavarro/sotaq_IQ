const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { email, maxEnergy } = JSON.parse(event.body);
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };

    const normalizedEmail = email.toLowerCase().trim();

    const { data: stats, error } = await supabase
      .from('user_stats')
      .select('daily_count, last_played_date')
      .ilike('email', normalizedEmail)
      .single();

    if (error || !stats) return { statusCode: 404, body: JSON.stringify({ error: 'Stats not found' }) };

    const today = new Date().toISOString().split('T')[0];

    if (stats.last_played_date !== today) {
      // New day — reset energy
      await supabase
        .from('user_stats')
        .update({ daily_count: maxEnergy, last_played_date: today })
        .ilike('email', normalizedEmail);

      return { statusCode: 200, body: JSON.stringify({ daily_count: maxEnergy, reset: true }) };
    }

    return { statusCode: 200, body: JSON.stringify({ daily_count: stats.daily_count, reset: false }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
