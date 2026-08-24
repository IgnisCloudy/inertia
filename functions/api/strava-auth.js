// ─────────────────────────────────────────────────────────────
// Inertia — Strava OAuth callback  (Cloudflare Pages Function)
// Route: /api/strava-auth
// ─────────────────────────────────────────────────────────────

const CLIENT_ID = '246568';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const origin = url.origin;                    // works on any domain
  const code = url.searchParams.get('code');
  const userId = url.searchParams.get('state');
  const denied = url.searchParams.get('error');

  const back = q => Response.redirect(origin + '/?' + q, 302);

  if (denied) return back('strava=denied');
  if (!code || !userId) return back('strava=error&msg=' + encodeURIComponent('Missing code or user'));

  const clientSecret = context.env.STRAVA_CLIENT_SECRET;
  const sbUrl = context.env.SUPABASE_URL;
  const sbKey = context.env.SUPABASE_SERVICE_KEY;

  if (!clientSecret) return back('strava=error&msg=' + encodeURIComponent('Missing STRAVA_CLIENT_SECRET'));
  if (!sbUrl || !sbKey) return back('strava=error&msg=' + encodeURIComponent('Missing Supabase env vars'));

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
      return back('strava=error&msg=' + encodeURIComponent('Token exchange failed'));
    }

    const athleteName = tok.athlete
      ? ((tok.athlete.firstname || '') + ' ' + (tok.athlete.lastname || '')).trim()
      : null;

    const save = await fetch(sbUrl + '/rest/v1/strava_tokens', {
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

    if (!save.ok) {
      const t = await save.text();
      return back('strava=error&msg=' + encodeURIComponent('Save failed: ' + t.slice(0, 120)));
    }

    return back('strava=connected');
  } catch (e) {
    return back('strava=error&msg=' + encodeURIComponent(e.message));
  }
}
