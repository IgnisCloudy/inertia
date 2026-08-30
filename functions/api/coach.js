// ─────────────────────────────────────────────────────────────
// Inertia — AI Coach chat
// Route: /api/coach
// Assembles the athlete's full picture and answers in their voice.
// ─────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: CORS });

const VOICES = {
  neutral:   'Plain, warm English. No slang.',
  bengaluru: 'Bengaluru English with light Kannada slang — macha, guru, boss, sakkath, bombat, swalpa. Sparing, never forced.',
  mumbai:    'Bambaiya Hindi-English mix — bhau, boss, ekdum, jhakaas, scene. Sparing, never forced.',
  delhi:     'Delhi Hindi-English mix — bhai, yaar, scene, full on. Sparing, never forced.',
  punjab:    'Punjabi-English mix — paaji, oye, chak de, balle. Sparing, never forced.',
  kolkata:   'Bengali-English mix — dada, darun, cholbe. Sparing, never forced.',
  gujarat:   'Gujarati-English mix — bhai, saras, majama. Sparing, never forced.',
  chennai:   'Tamil-English mix — machan, semma, da. Sparing, never forced.',
  hyderabad: 'Hyderabadi Telugu-English mix — anna, bagundi, baap re. Sparing, never forced.'
};

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
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const region = body.region || 'neutral';
  const streak = body.streak || 0;
  if (!userId || !messages.length) return json({ error: 'Missing user_id or messages' }, 400);

  const H = { apikey: sbKey, Authorization: 'Bearer ' + sbKey, 'Content-Type': 'application/json' };
  const today = new Date().toISOString().split('T')[0];
  const back14 = new Date(Date.now() - 14 * 86400000).toISOString();
  const ahead = new Date(Date.now() + 8 * 86400000).toISOString().split('T')[0];

  try {
    const [profR, goalR, planR, sessR, actR, mealR] = await Promise.all([
      fetch(sbUrl + '/rest/v1/profiles?id=eq.' + userId + '&select=*', { headers: H }),
      fetch(sbUrl + '/rest/v1/goals?user_id=eq.' + userId + '&is_active=eq.true&select=*', { headers: H }),
      fetch(sbUrl + '/rest/v1/plans?user_id=eq.' + userId + '&is_active=eq.true&select=*', { headers: H }),
      fetch(sbUrl + '/rest/v1/sessions?user_id=eq.' + userId + '&session_date=gte.' + today +
            '&session_date=lte.' + ahead + '&select=session_date,sport,title,planned,status&order=session_date.asc', { headers: H }),
      fetch(sbUrl + '/rest/v1/strava_activities?user_id=eq.' + userId + '&start_date=gte.' + back14 +
            '&select=sport,name,distance_m,moving_time_s,avg_hr,start_date&order=start_date.desc', { headers: H }),
      fetch(sbUrl + '/rest/v1/meals?user_id=eq.' + userId + '&meal_date=eq.' + today +
            '&select=name,calories,protein_g,carbs_g,fat_g,slot', { headers: H })
    ]);

    const profile = (await profR.json())[0] || {};
    const goal = (await goalR.json())[0] || {};
    const plan = (await planR.json())[0] || {};
    const sessions = await sessR.json();
    const acts = await actR.json();
    const meals = await mealR.json();

    const daysToGoal = goal.target_date
      ? Math.max(0, Math.round((new Date(goal.target_date) - new Date(today)) / 86400000))
      : null;

    const nut = (meals || []).reduce((a, m) => ({
      k: a.k + (m.calories || 0), p: a.p + (m.protein_g || 0),
      c: a.c + (m.carbs_g || 0), f: a.f + (m.fat_g || 0)
    }), { k:0, p:0, c:0, f:0 });

    const upcoming = (Array.isArray(sessions) ? sessions : []).map(s =>
      s.session_date + ' ' + s.sport + ' — ' + s.title +
      ' (' + ((s.planned && s.planned.duration_min) || 0) + 'min, ' +
      ((s.planned && s.planned.intensity) || 'easy') + ')' +
      (s.status === 'done' ? ' [done]' : '')).join('\n') || '(nothing scheduled)';

    const recent = (Array.isArray(acts) ? acts : []).slice(0, 12).map(a =>
      (a.start_date || '').split('T')[0] + ' ' + a.sport + ' ' +
      (a.distance_m ? (a.distance_m/1000).toFixed(1) + 'km ' : '') +
      (a.moving_time_s ? Math.round(a.moving_time_s/60) + 'min' : '') +
      (a.avg_hr ? ' @' + Math.round(a.avg_hr) + 'bpm' : '')).join('\n') || '(no recent activity)';

    const systemPrompt = [
      'You are Coach — a sharp, experienced endurance coach who knows this athlete well.',
      'You are talking to them directly in a chat inside their training app called Inertia.',
      '',
      'VOICE: ' + (VOICES[region] || VOICES.neutral),
      'Be warm and direct, like a good coach who is also a friend. Never corporate, never preachy.',
      'Keep replies short — usually 2 to 5 sentences. This is a chat, not an essay.',
      'Use their real numbers when relevant. Specific beats generic every time.',
      'If they missed sessions, be understanding and practical, never scolding.',
      'If asked something you genuinely cannot know, say so plainly.',
      'You are not a doctor. For pain, injury or medical worries, say clearly they should see a professional.',
      '',
      '── ATHLETE ──',
      'Name: ' + (profile.full_name || 'athlete'),
      'Age ' + (profile.age || '?') + ', ' + (profile.weight_kg || '?') + 'kg, ' + (profile.height_cm || '?') + 'cm, ' + (profile.sex || '?'),
      'Diet: ' + (profile.diet || '?') + ' · Level: ' + (profile.fitness_level || '?'),
      'Sports: ' + ((profile.sports || []).join(', ') || '?'),
      'Current streak: ' + streak + ' days',
      '',
      '── GOAL ──',
      (goal.goal_label || 'general fitness') + (goal.target_date ? ' on ' + goal.target_date : ''),
      daysToGoal !== null ? daysToGoal + ' days away' : 'no fixed date',
      '',
      '── PLAN ──',
      (plan.title || 'no plan') + (plan.start_date ? ' (' + plan.start_date + ' → ' + plan.end_date + ')' : ''),
      'Phases: ' + JSON.stringify(plan.phases || []),
      '',
      '── NEXT 7 DAYS ──',
      upcoming,
      '',
      '── LAST 14 DAYS, ACTUAL (Strava) ──',
      recent,
      '',
      '── TODAY\'S FOOD SO FAR ──',
      Math.round(nut.k) + ' kcal · ' + Math.round(nut.p) + 'g protein · ' +
      Math.round(nut.c) + 'g carbs · ' + Math.round(nut.f) + 'g fat' +
      ((meals || []).length ? ' (' + meals.length + ' items logged)' : ' (nothing logged yet)'),
      '',
      'TODAY: ' + today
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
        max_tokens: 700,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!res.ok) {
      const t = await res.text();
      return json({ error: 'Coach unavailable: ' + t.slice(0, 250) }, res.status);
    }

    const data = await res.json();
    if (!data.content || !data.content[0]) return json({ error: 'Empty reply' }, 500);

    return json({ reply: data.content[0].text.trim() });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
