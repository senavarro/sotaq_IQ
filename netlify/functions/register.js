const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { name, phone, email } = JSON.parse(event.body);
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };

    const normalizedEmail = email.toLowerCase().trim();

    // Check if already exists
    const { data: existing } = await supabase
      .from('allowed_users')
      .select('email')
      .ilike('email', normalizedEmail)
      .single();

    if (existing) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'Este email já está registado.' })
      };
    }

    // Insert user
    const { error: insertUserError } = await supabase
      .from('allowed_users')
      .insert([{ email: normalizedEmail, name, phone, plan_type: 'free' }]);

    if (insertUserError) {
      return { statusCode: 500, body: JSON.stringify({ error: insertUserError.message }) };
    }

    // Insert stats
    const today = new Date().toISOString().split('T')[0];
    const { error: insertStatsError } = await supabase
      .from('user_stats')
      .insert([{
        email: normalizedEmail,
        daily_count: 5,
        total_xp: 0,
        last_played_date: today,
        streak: 0
      }]);

    if (insertStatsError) {
      return { statusCode: 500, body: JSON.stringify({ error: insertStatsError.message }) };
    }

    // Return fresh data
    const { data: stats } = await supabase
      .from('user_stats')
      .select('*')
      .ilike('email', normalizedEmail)
      .single();

    const user = { email: normalizedEmail, name, phone, plan_type: 'free' };

    return {
      statusCode: 200,
      body: JSON.stringify({ user, stats })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
