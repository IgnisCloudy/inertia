const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }) };
  }

  var body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  var profile = body.profile || {};
  var goal = body.goal || {};
  var baseline = body.baseline || {};
  var today = new Date().toISOString().split('T')[0];
  var targetDate = goal.target_date || 'no target date';

  var systemPrompt = [
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

  var userMessage = [
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

  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, 22000);

  try {
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
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

    clearTimeout(timeoutId);

    if (!response.ok) {
      var errText = await response.text();
      return { statusCode: response.status, headers: CORS, body: JSON.stringify({ error: 'Claude API error: ' + errText.slice(0, 500) }) };
    }

    var data = await response.json();
    if (!data.content || !data.content[0]) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Empty response from Claude' }) };
    }
    var rawText = data.content[0].text.trim();
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();

    var compact;
    try { compact = JSON.parse(rawText); }
    catch (parseErr) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Could not parse plan JSON', rawSnippet: rawText.substring(0, 300) }) };
    }

    var expanded = {
      title: compact.title,
      start_date: compact.start,
      end_date: compact.end,
      phases: compact.phases || [],
      sessions: (compact.sessions || []).map(function(row) {
        return {
          date: row[0],
          sport: row[1],
          title: row[2],
          duration_min: row[3],
          intensity: row[4],
          planned: { notes: row[5] }
        };
      })
    };

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ plan: expanded }) };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      return { statusCode: 504, headers: CORS, body: JSON.stringify({ error: 'Plan generation took too long — please try again' }) };
    }
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
