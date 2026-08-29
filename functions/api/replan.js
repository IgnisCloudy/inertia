// ─────────────────────────────────────────────────────────────
// Inertia — Adaptive Replanning Engine
// Route: /api/replan
// Reads plan + real activity, asks Claude for revised sessions.
// Returns a PROPOSAL only — the client applies it after approval.
// ─────────────────────────────────────────────────────────────

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
  const apiKey = context.env.ANTHROPIC_API_KEY;
  const sbUrl = context.env.SUPABASE_URL;
  const sbKey = context.env.SUPABASE_SERVICE_KEY;
  if (!apiKey || !sbUrl || !sbKey) return json({ error: 'Missing env vars' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const userId = body.user_id;
  const planId = body.plan_id;
  const userRequest = (body.request || '').slice(0, 400);
  if (!userId || !planId) return json({ error: 'Missing user_id or plan_id' }, 400);

  const H = { apikey: sbKey, Authorization: 'Bearer ' + sbKey, 'Content-Type': 'application/json' };
  const today = new Date().toISOString().split('T')[0];
  const back14 = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  try {
    // ── context ──
    const [planR, profR, goalR, futR, pastR, actR] = await Promise.all([
      fetch(sbUrl + '/rest/v1/plans?id=eq.' + planId + '&select=*', { headers: H }),
      fetch(sbUrl + '/rest/v1/profiles?id=eq.' + userId + '&select=*', { headers: H }),
      fetch(sbUrl + '/rest/v1/goals?user_id=eq.' + userId + '&is_active=eq.true&select=*', { headers: H }),
      fetch(sbUrl + '/rest/v1/sessions?user_id=eq.' + userId + '&plan_id=eq.' + planId +
            '&session_date=gte.' + today + '&select=id,session_date,sport,title,planned,status&order=session_date.asc', { headers: H }),
      fetch(sbUrl + '/rest/v1/sessions?user_id=eq.' + userId + '&plan_id=eq.' + planId +
            '&session_date=gte.' + back14 + '&session_date=lt.' + today +
            '&select=session_date,sport,title,status,actual&order=session_date.asc', { headers: H }),
      fetch(sbUrl + '/rest/v1/strava_activities?user_id=eq.' + userId +
            '&start_date=gte.' + back14 + '&select=sport,name,distance_m,moving_time_s,avg_hr,start_date&order=start_date.desc', { headers: H })
    ]);

    const plan = (await planR.json())[0];
    const profile = (await profR.json())[0] || {};
    const goal = (await goalR.json())[0] || {};
    const future = await futR.json();
    const past = await pastR.json();
    const acts = await actR.json();

    if (!plan) return json({ error: 'Plan not found' }, 404);
    if (!Array.isArray(future) || !future.length) return json({ error: 'No upcoming sessions to adjust' }, 400);

    // ── compact context for the model ──
    const actLines = (acts || []).slice(0, 20).map(a =>
      (a.start_date || '').split('T')[0] + ' ' + a.sport +
      ' ' + (a.distance_m ? (a.distance_m / 1000).toFixed(1) + 'km' : '') +
      ' ' + (a.moving_time_s ? Math.round(a.moving_time_s / 60) + 'min' : '')
    ).join('\n');

    const pastLines = (past || []).map(s =>
      s.session_date + ' planned ' + s.sport + ' (' + s.title + ') → ' + s.status
    ).join('\n');

    const futureLines = future.map(s =>
      s.session_date + ' ' + s.sport + ' | ' + s.title +
      ' | ' + ((s.planned && s.planned.duration_min) || 0) + 'min' +
      ' | ' + ((s.planned && s.planned.intensity) || 'easy')
    ).join('\n');

    const systemPrompt = [
      'You are an elite endurance coach revising an athlete\'s training plan.',
      'Return ONLY JSON. No prose, no markdown, no code fences.',
      '',
      'SCHEMA:',
      '{',
      '  "summary": "one sentence on what you changed and why",',
      '  "rationale": "2-3 sentences of coaching reasoning",',
      '  "sessions": [[date, sport, title, minutes, intensity, notes]]',
      '}',
      '',
      'sessions: array of arrays, 6 items each:',
      '  0 date YYYY-MM-DD, 1 sport (run|bike|swim|strength|rest),',
      '  2 title (5 words max), 3 minutes int, 4 intensity (easy|moderate|hard|rest),',
      '  5 notes (one short sentence)',
      '',
      'VOICE:',
      '- The athlete is from Bangalore. Write summary and rationale like a sharp local coach who is a friend, not a corporate trainer.',
      '- Warm, direct, a little playful. Light Bangalore/Indian-English flavour is welcome ("macha", "boss", "guru", "sakkath", "full josh") but use it sparingly — at most once per paragraph, never forced.',
      '- Never scold. If they missed sessions, be understanding and practical about it.',
      '',
      'EVENTS:',
      '- If the athlete mentions an event, ride, race or trip on a date (e.g. a long ride, a 10K, a marathon), treat it as a real fixture.',
      '- Build TOWARD it: progressively longer or more specific sessions in the days before.',
      '- Taper into it: ease off 1-2 days prior so they arrive fresh.',
      '- Recover after it: easy or rest for 1-2 days following, scaled to how hard the event was.',
      '- Put the event itself in the plan on its date, with sport and a realistic duration.',
      '',
      'RULES:',
      '- Revise ONLY the dates present in the UPCOMING list. Same dates, same count.',
      '- Respect the goal and its date. Do not abandon the long-term build.',
      '- If sessions were missed, do NOT simply cram them in. Reduce and rebuild sensibly.',
      '- If the athlete trains different sports than planned, shift the plan toward what they actually do.',
      '- Honour injuries and any stated constraint absolutely.',
      '- Keep at least one genuine rest day per 7 days.',
      '- Never increase weekly load by more than ~10% versus what they have actually been doing.'
    ].join('\n');

    const userMessage = [
      'ATHLETE: age=' + (profile.age || '?') + ' weight=' + (profile.weight_kg || '?') + 'kg' +
      ' level=' + (profile.fitness_level || '?') + ' sports=' + ((profile.sports || []).join(',') || '?'),
      'GOAL: ' + (goal.goal_label || 'general fitness') + ' on ' + (goal.target_date || 'no date'),
      'PLAN: ' + (plan.title || '') + ' (' + plan.start_date + ' → ' + plan.end_date + ')',
      '',
      'LAST 14 DAYS — WHAT WAS PLANNED:',
      pastLines || '(nothing)',
      '',
      'LAST 14 DAYS — WHAT THEY ACTUALLY DID (Strava):',
      actLines || '(no activities)',
      '',
      'UPCOMING SESSIONS TO REVISE:',
      futureLines,
      '',
      userRequest
        ? 'ATHLETE REQUEST: "' + userRequest + '"'
        : 'No specific request — revise based on the gap between plan and reality.',
      '',
      'TODAY: ' + today,
      '',
      'Return the revised sessions JSON now.'
    ].join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!res.ok) {
      const t = await res.text();
      return json({ error: 'Claude error: ' + t.slice(0, 300) }, res.status);
    }

    const data = await res.json();
    if (!data.content || !data.content[0]) return json({ error: 'Empty response' }, 500);

    let raw = data.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();

    let out;
    try { out = JSON.parse(raw); }
    catch { return json({ error: 'Could not parse revision', rawSnippet: raw.slice(0, 300) }, 500); }

    // ── map revisions onto existing session ids ──
    const byDate = {};
    future.forEach(s => { byDate[s.session_date] = s; });

    const changes = (out.sessions || []).map(r => {
      const existing = byDate[r[0]];
      if (!existing) return null;
      const before = {
        sport: existing.sport,
        title: existing.title,
        duration_min: (existing.planned && existing.planned.duration_min) || 0,
        intensity: (existing.planned && existing.planned.intensity) || 'easy'
      };
      const after = { sport: r[1], title: r[2], duration_min: r[3], intensity: r[4], notes: r[5] };
      const changed = before.sport !== after.sport
        || before.title !== after.title
        || before.duration_min !== after.duration_min
        || before.intensity !== after.intensity;
      return { id: existing.id, date: r[0], before, after, changed };
    }).filter(Boolean);

    return json({
      summary: out.summary || 'Plan revised.',
      rationale: out.rationale || '',
      changes,
      changedCount: changes.filter(c => c.changed).length
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
