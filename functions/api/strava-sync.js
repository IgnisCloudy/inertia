// ─────────────────────────────────────────────────────────────
// Inertia — Strava sync  (Cloudflare Pages Function)
// Route: /api/strava-sync
// ─────────────────────────────────────────────────────────────

const CLIENT_ID = '246568';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: CORS });

const SPORT_MAP = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run', Treadmill: 'run',
  Ride: 'bike', VirtualRide: 'bike', GravelRide: 'bike', MountainBikeRide: 'bike', EBikeRide: 'bike',
  Swim: 'swim',
  WeightTraining: 'strength', Workout: 'strength', Crossfit: 'strength',
  Walk: 'run', Hike: 'run'
};

export async function onRequestOptions() {
  return new Response('', { status: 200, headers: CORS });
}

export async function onRequestPost(context) {
  const sbUrl = context.env.SUPABASE_URL;
  const sbKey = context.env.SUPABASE_SERVICE_KEY;
  const clientSecret = context.env.STRAVA_CLIENT_SECRET;
  if (!sbUrl || !sbKey || !clientSecret) return json({ error: 'Missing env vars' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const userId = body.user_id;
  if (!userId) return json({ error: 'Missing user_id' }, 400);

  const H = {
    'apikey': sbKey,
    'Authorization': 'Bearer ' + sbKey,
    'Content-Type': 'application/json'
  };

  try {
    // 1. stored token
    const tRes = await fetch(sbUrl + '/rest/v1/strava_tokens?user_id=eq.' + userId + '&select=*', { headers: H });
    const rows = await tRes.json();
    if (!rows.length) return json({ error: 'Strava not connected' }, 404);
    let tok = rows[0];

    // 2. refresh if needed
    const nowSec = Math.floor(Date.now() / 1000);
    if (!tok.expires_at || tok.expires_at <= nowSec + 120) {
      const rRes = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: tok.refresh_token
        }).toString()
      });
      const nt = await rRes.json();
      if (!rRes.ok || nt.errors) {
        await fetch(sbUrl + '/rest/v1/strava_tokens?user_id=eq.' + userId, { method: 'DELETE', headers: H });
        return json({ error: 'Strava session expired. Tap Connect to re-authorize.', reconnect: true }, 401);
      }
      tok.access_token = nt.access_token;
      await fetch(sbUrl + '/rest/v1/strava_tokens?user_id=eq.' + userId, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({
          access_token: nt.access_token, refresh_token: nt.refresh_token,
          expires_at: nt.expires_at, updated_at: new Date().toISOString()
        })
      });
    }

    // 3. fetch activities (last 30 days)
    const after = Math.floor(Date.now() / 1000) - 30 * 86400;
    const aRes = await fetch(
      'https://www.strava.com/api/v3/athlete/activities?per_page=50&after=' + after,
      { headers: { Authorization: 'Bearer ' + tok.access_token } }
    );

    if (!aRes.ok) {
      const errTxt = await aRes.text();
      if (aRes.status === 401) {
        await fetch(sbUrl + '/rest/v1/strava_tokens?user_id=eq.' + userId, { method: 'DELETE', headers: H });
        return json({ error: 'Strava access was revoked. Tap Connect to re-authorize.', reconnect: true }, 401);
      }
      return json({ error: errTxt.slice(0, 250) }, aRes.status);
    }

    const acts = await aRes.json();
    if (!Array.isArray(acts)) return json({ error: 'Unexpected Strava response' }, 500);

    // 4. store
    const rowsToSave = acts.map(a => ({
      user_id: userId,
      strava_id: a.id,
      sport: SPORT_MAP[a.type] || SPORT_MAP[a.sport_type] || 'other',
      name: a.name,
      distance_m: a.distance,
      moving_time_s: a.moving_time,
      avg_hr: a.average_heartrate || null,
      avg_speed: a.average_speed || null,
      elevation_m: a.total_elevation_gain || null,
      start_date: a.start_date_local,
      raw: { type: a.type, sport_type: a.sport_type, max_hr: a.max_heartrate || null }
    }));

    if (rowsToSave.length) {
      await fetch(sbUrl + '/rest/v1/strava_activities?on_conflict=user_id,strava_id', {
        method: 'POST',
        headers: Object.assign({}, H, { 'Prefer': 'resolution=merge-duplicates' }),
        body: JSON.stringify(rowsToSave)
      });
    }

    // 5. match to planned sessions
    const sRes = await fetch(
      sbUrl + '/rest/v1/sessions?user_id=eq.' + userId + '&status=eq.planned&select=id,session_date,sport',
      { headers: H }
    );
    const sessions = await sRes.json();
    let matched = 0;

    for (const a of rowsToSave) {
      const day = (a.start_date || '').split('T')[0];
      const hit = Array.isArray(sessions)
        ? sessions.find(s => s.session_date === day && s.sport === a.sport)
        : null;
      if (!hit) continue;
      await fetch(sbUrl + '/rest/v1/sessions?id=eq.' + hit.id, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({
          status: 'done',
          actual: {
            distance_km: a.distance_m ? +(a.distance_m / 1000).toFixed(2) : null,
            duration_min: a.moving_time_s ? Math.round(a.moving_time_s / 60) : null,
            avg_hr: a.avg_hr, source: 'strava', name: a.name
          }
        })
      });
      matched++;
      const idx = sessions.findIndex(s => s.id === hit.id);
      if (idx > -1) sessions.splice(idx, 1);
    }

    return json({ synced: rowsToSave.length, matched: matched, athlete: tok.athlete_name });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
