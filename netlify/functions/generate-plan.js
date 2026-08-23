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
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  var profile = body.profile || {};
  var goal = body.goal || {};
  var baseline = body.baseline || {};
  var mode = body.mode || 'initial'; // 'initial' | 'extend'

  var today = new Date().toISOString().split('T')[0];
  var targetDate = goal.target_date || 'not specified';

  var systemPrompt = [
    'You are an elite endurance coach generating personalized training plans.',
    'You produce structured JSON ONLY - no prose, no markdown, no code fences.',
    '',
    'Your response must be a single valid JSON object with this exact shape:',
    '{',
    '  "title": "Plan name, human friendly",',
    '  "start_date": "YYYY-MM-DD",',
    '  "end_date": "YYYY-MM-DD",',
    '  "phases": [',
    '    { "name": "Base build", "weeks": 4, "focus": "one-line focus" }',
    '  ],',
    '  "sessions": [',
    '    { "date": "YYYY-MM-DD", "sport": "run|bike|swim|strength|rest",',
    '      "title": "Session name", "duration_min": 30, "intensity": "easy|moderate|hard|rest",',
    '      "planned": { "distance_km": 3, "notes": "coach notes for this session" } }',
    '  ]',
    '}',
    '',
    'RULES:',
    '- phases: cover the entire journey from start_date to end_date (high-level roadmap)',
    '- sessions: FULL DAILY sessions for the FIRST 4 WEEKS ONLY (28 session objects, one per day)',
    '- If user has an injury or restriction, honor it strictly',
    '- Rest days are sessions with sport "rest", duration_min 0, intensity "rest"',
    '- Progressive overload: start conservative, build gradually',
    '- Match sports to what the user actually does; do not add sports they did not select',
    '- If goal is a race, sessions must build toward race demands',
    '- If goal is "general fitness", focus on sustainable habits, mix of sports',
    '- Notes should be short (1-2 sentences), specific, actionable'
  ].join('\n');

  var userMessage = [
    'Generate a training plan.',
    '',
    'ATHLETE PROFILE:',
    '- Age: ' + (profile.age || 'not specified'),
    '- Height: ' + (profile.height_cm || 'not specified') + ' cm',
    '- Weight: ' + (profile.weight_kg || 'not specified') + ' kg',
    '- Sex: ' + (profile.sex || 'not specified'),
    '- Diet: ' + (profile.diet || 'not specified'),
    '- Fitness level: ' + (profile.fitness_level || 'not specified'),
    '- Sports they do: ' + ((profile.sports || []).join(', ') || 'not specified'),
    '',
    'GOAL:',
    '- Type: ' + (goal.goal_type || 'general fitness'),
    '- Label: ' + (goal.goal_label || 'not specified'),
    '- Target date: ' + targetDate,
    '',
    'CURRENT BASELINE:',
    '- Training days per week now: ' + (baseline.days_per_week || 'not specified'),
    '- Injuries/restrictions: ' + (baseline.injuries || 'none'),
    '- Other notes: ' + (baseline.notes || 'none'),
    '',
    'TODAY: ' + today,
    '',
    'Generate the plan now. Start sessions from today. Return ONLY the JSON object.'
  ].join('\n');

  try {
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      var errText = await response.text();
      return { statusCode: response.status, headers: CORS, body: JSON.stringify({ error: 'Claude API error: ' + errText }) };
    }

    var data = await response.json();
    var rawText = data.content[0].text.trim();

    // Strip any accidental code fences
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();

    var plan;
    try {
      plan = JSON.parse(rawText);
    } catch (parseErr) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({
          error: 'Failed to parse plan JSON from Claude',
          rawText: rawText.substring(0, 500)
        })
      };
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ plan: plan })
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
