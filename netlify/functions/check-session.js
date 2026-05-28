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

    // Check allowed_users
    const { data: user, error: userError } = await supabase
      .from('allowed_users')
      .select('email, name, phone, plan_type')
      .ilike('email', normalizedEmail)
      .single();

    if (userError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Email não encontrado. Verifique ou crie uma conta.' })
      };
    }

    // Fetch stats
    const { data: stats, error: statsError } = await supabase
      .from('user_stats')
      .select('*')
      .ilike('email', normalizedEmail)
      .single();

    if (statsError || !stats) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Stats não encontrados.' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ user, stats })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
