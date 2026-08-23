const CLIENT_ID = '246568';
const APP_URL = 'https://tryathelete.netlify.app';

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const code = params.code;
  const userId = params.state;
  const err = params.error;

  if (err) return redirect('strava=denied');
  if (!code || !userId) return redirect('strava=error&msg=' + encodeURIComponent('Missing code or user'));

  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  if (!clientSecret) return redirect('strava=error&msg=' + encodeURIComponent('Missing STRAVA_CLIENT_SECRET'));
  if (!sbUrl || !sbKey) return redirect('strava=error&msg=' + encodeURIComponent('Missing Supabase env vars'));

  try {
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code'
      }).toString()
    });

    const tok = await tokenRes.json();
    if (!tokenRes.ok || tok.errors) {
      return redirect('strava=error&msg=' + encodeURIComponent('Token exchange failed'));
    }

    const athleteName = tok.athlete
      ? ((tok.athlete.firstname || '') + ' ' + (tok.athlete.lastname || '')).trim()
      : null;

    const upsert = await fetch(sbUrl + '/rest/v1/strava_tokens', {
      method: 'POST',
      headers: {
        'apikey': sbKey,
        'Authorization': 'Bearer ' + sbKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        user_id: userId,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: tok.expires_at,
        athlete_name: athleteName,
        updated_at: new Date().toISOString()
      })
    });

    if (!upsert.ok) {
      const t = await upsert.text();
      return redirect('strava=error&msg=' + encodeURIComponent('Save failed: ' + t.slice(0, 120)));
    }

    return redirect('strava=connected');
  } catch (e) {
    return redirect('strava=error&msg=' + encodeURIComponent(e.message));
  }
};

function redirect(q) {
  return { statusCode: 302, headers: { Location: APP_URL + '/?' + q }, body: '' };
}
