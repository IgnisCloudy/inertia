// ─────────────────────────────────────────────────────────────
// Inertia — full detail for one Strava activity
// Route: /api/strava-activity
// Fetched lazily on tap (Strava rate limits make eager loading unwise),
// then cached into strava_activities.raw.
// ─────────────────────────────────────────────────────────────

const CLIENT_ID = '246568';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: CORS });

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
  const stravaId = body.strava_id;
  const force = !!body.force;
  if (!userId || !stravaId) return json({ error: 'Missing user_id or strava_id' }, 400);

  const H = { apikey: sbKey, Authorization: 'Bearer ' + sbKey, 'Content-Type': 'application/json' };

  try {
    // cached?
    const cRes = await fetch(sbUrl + '/rest/v1/strava_activities?user_id=eq.' + userId +
      '&strava_id=eq.' + stravaId + '&select=id,raw', { headers: H });
    const rows = await cRes.json();
    const row = rows && rows[0];
    if (!force && row && row.raw && row.raw.detail) {
      return json({ cached: true, detail: row.raw.detail, zones: row.raw.zones || null });
    }

    // token (refresh if needed)
    const tRes = await fetch(sbUrl + '/rest/v1/strava_tokens?user_id=eq.' + userId + '&select=*', { headers: H });
    const toks = await tRes.json();
    if (!toks.length) return json({ error: 'Strava not connected' }, 404);
    let tok = toks[0];

    const nowSec = Math.floor(Date.now() / 1000);
    if (!tok.expires_at || tok.expires_at <= nowSec + 120) {
      const rRes = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID, client_secret: clientSecret,
          grant_type: 'refresh_token', refresh_token: tok.refresh_token
        }).toString()
      });
      const nt = await rRes.json();
      if (!rRes.ok || nt.errors) return json({ error: 'Reconnect Strava', reconnect: true }, 401);
      tok.access_token = nt.access_token;
      await fetch(sbUrl + '/rest/v1/strava_tokens?user_id=eq.' + userId, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({
          access_token: nt.access_token, refresh_token: nt.refresh_token,
          expires_at: nt.expires_at, updated_at: new Date().toISOString()
        })
      });
    }

    const AH = { Authorization: 'Bearer ' + tok.access_token };

    const dRes = await fetch('https://www.strava.com/api/v3/activities/' + stravaId + '?include_all_efforts=false', { headers: AH });
    if (!dRes.ok) {
      const t = await dRes.text();
      if (dRes.status === 401) return json({ error: 'Reconnect Strava', reconnect: true }, 401);
      if (dRes.status === 429) return json({ error: 'Strava rate limit hit — try again in a few minutes.' }, 429);
      return json({ error: t.slice(0, 200) }, dRes.status);
    }
    const full = await dRes.json();

    // zones are subscriber-only; failure here is fine
    let zones = null;
    try {
      const zRes = await fetch('https://www.strava.com/api/v3/activities/' + stravaId + '/zones', { headers: AH });
      if (zRes.ok) zones = await zRes.json();
    } catch {}

    // keep only what the UI needs
    const detail = {
      id: full.id,
      name: full.name,
      description: full.description || null,
      type: full.sport_type || full.type,
      start_date_local: full.start_date_local,
      distance: full.distance,
      moving_time: full.moving_time,
      elapsed_time: full.elapsed_time,
      total_elevation_gain: full.total_elevation_gain,
      average_speed: full.average_speed,
      max_speed: full.max_speed,
      average_heartrate: full.average_heartrate,
      max_heartrate: full.max_heartrate,
      average_cadence: full.average_cadence,
      average_watts: full.average_watts,
      max_watts: full.max_watts,
      weighted_average_watts: full.weighted_average_watts,
      kilojoules: full.kilojoules,
      calories: full.calories,
      suffer_score: full.suffer_score,
      achievement_count: full.achievement_count,
      kudos_count: full.kudos_count,
      pr_count: full.pr_count,
      device_name: full.device_name || null,
      gear: full.gear ? full.gear.name : null,
      splits_metric: (full.splits_metric || []).map(s => ({
        split: s.split, distance: s.distance, moving_time: s.moving_time,
        elevation_difference: s.elevation_difference,
        average_speed: s.average_speed, average_heartrate: s.average_heartrate || null
      })),
      laps: (full.laps || []).slice(0, 30).map(l => ({
        name: l.name, distance: l.distance, moving_time: l.moving_time,
        average_speed: l.average_speed, average_heartrate: l.average_heartrate || null
      })),
      polyline: full.map ? (full.map.polyline || full.map.summary_polyline || null) : null,
      photo: full.photos && full.photos.primary && full.photos.primary.urls
        ? (full.photos.primary.urls['600'] || full.photos.primary.urls['100'] || null) : null,
      photo_count: full.total_photo_count || 0
    };

    if (row) {
      const merged = Object.assign({}, row.raw || {}, { detail: detail, zones: zones });
      await fetch(sbUrl + '/rest/v1/strava_activities?id=eq.' + row.id, {
        method: 'PATCH', headers: H, body: JSON.stringify({ raw: merged })
      });
    }

    return json({ cached: false, detail: detail, zones: zones });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
