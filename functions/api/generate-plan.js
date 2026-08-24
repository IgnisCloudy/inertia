// ─────────────────────────────────────────────────────────────
// Inertia — Plan Generator  (Cloudflare Pages Function)
// Route: /api/generate-plan
// ─────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: CORS });

export async function onRequestOptions() {
  return new Response('', { status: 200, headers: CORS });
}

export async function onRequestPost(context) {
  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'Missing ANTHROPIC_API_KEY' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const profile = body.profile || {};
  const goal = body.goal || {};
  const baseline = body.baseline || {};
  const today = new Date().toISOString().split('T')[0];
  const targetDate = goal.target_date || 'no target date';

  const systemPrompt = [
    'You generate endurance training plans as compact JSON.',
    'Return ONLY a JSON object, no prose, no markdown, no code fences.',
    '',
    'SCHEMA:',
    '{',
    '  "title": "short plan name",',
    '  "start": "YYYY-MM-DD",',
    '  "end": "YYYY-MM-DD",',
    '  "phases": [{"name":"Phase name","weeks":N,"focus":"one-line focus"}],',
    '  "sessions": [[date, sport, title, minutes, intensity, notes]]',
    '}',
    '',
    'sessions is an ARRAY of ARRAYS. Each inner array is exactly 6 items:',
    '  0: date "YYYY-MM-DD"',
    '  1: sport (run|bike|swim|strength|rest)',
    '  2: title (short, 5 words max)',
    '  3: minutes (integer, 0 for rest)',
    '  4: intensity (easy|moderate|hard|rest)',
    '  5: notes (one short sentence)',
    '',
    'RULES:',
    '- phases cover whole journey (start to end date, high-level)',
    '- sessions cover FIRST 28 DAYS ONLY, one per day, starting today',
    '- Honor injuries strictly',
    '- Progressive overload; start easy, build gradually',
    '- Only sports the user does',
    '- Rest days: sport=rest, minutes=0, intensity=rest'
  ].join('\n');

  const userMessage = [
    'ATHLETE:',
    'age=' + (profile.age || '?'),
    'weight=' + (profile.weight_kg || '?') + 'kg',
    'height=' + (profile.height_cm || '?') + 'cm',
    'sex=' + (profile.sex || '?'),
    'diet=' + (profile.diet || '?'),
    'level=' + (profile.fitness_level || '?'),
    'sports=' + ((profile.sports || []).join(',') || '?'),
    '',
    'GOAL:',
    'type=' + (goal.goal_type || 'healthy'),
    'label=' + (goal.goal_label || '?'),
    'target=' + targetDate,
    '',
    'BASELINE:',
    'trains ' + (baseline.days_per_week || '?') + ' days/week',
    'injuries=' + (baseline.injuries || 'none'),
    'notes=' + (baseline.notes || 'none'),
    '',
    'TODAY: ' + today,
    '',
    'Generate the plan JSON now. Start sessions from today.'
  ].join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!res.ok) {
      const t = await res.text();
      return json({ error: 'Claude API error: ' + t.slice(0, 400) }, res.status);
    }

    const data = await res.json();
    if (!data.content || !data.content[0]) return json({ error: 'Empty response from Claude' }, 500);

    let raw = data.content[0].text.trim();
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();

    let compact;
    try { compact = JSON.parse(raw); }
    catch { return json({ error: 'Could not parse plan JSON', rawSnippet: raw.slice(0, 300) }, 500); }

    const expanded = {
      title: compact.title,
      start_date: compact.start,
      end_date: compact.end,
      phases: compact.phases || [],
      sessions: (compact.sessions || []).map(r => ({
        date: r[0], sport: r[1], title: r[2],
        duration_min: r[3], intensity: r[4],
        planned: { notes: r[5] }
      }))
    };

    return json({ plan: expanded });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
