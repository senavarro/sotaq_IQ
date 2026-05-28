const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { email, plan_type } = JSON.parse(event.body);
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'Email required' }) };

    const { error } = await supabase
      .from('user_stats')
      .update({ plan_type })
      .ilike('email', email.toLowerCase().trim());

    if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) };

    // Also update allowed_users if it exists
    await supabase
      .from('allowed_users')
      .update({ plan_type })
      .ilike('email', email.toLowerCase().trim());

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
