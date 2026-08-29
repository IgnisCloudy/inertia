// ─────────────────────────────────────────────────────────────
// Inertia — Food photo analysis
// Route: /api/scan-food
// Takes a compressed base64 image, returns identified items + macros.
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
  if (!apiKey) return json({ error: 'Missing ANTHROPIC_API_KEY' }, 500);

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400); }

  const image = body.image;          // base64, no data: prefix
  const mediaType = body.media_type || 'image/jpeg';
  const diet = body.diet || 'unspecified';
  const hint = (body.hint || '').slice(0, 120);
  if (!image) return json({ error: 'No image provided' }, 400);

  const systemPrompt = [
    'You identify food from a photo and estimate its nutrition.',
    'Return ONLY JSON — no prose, no markdown, no code fences.',
    '',
    'SCHEMA:',
    '{',
    '  "items": [{"name":"food name","serving":"what you see, e.g. 1 bowl / 2 rotis / 250ml",',
    '             "calories":N,"protein_g":N,"carbs_g":N,"fat_g":N}],',
    '  "total": {"calories":N,"protein_g":N,"carbs_g":N,"fat_g":N},',
    '  "confidence": "high|medium|low",',
    '  "note": "one short sentence — a caveat or a useful observation"',
    '}',
    '',
    'RULES:',
    '- List each distinct food separately. Combine only what is genuinely one dish.',
    '- Estimate the portion actually visible, not a standard serving size.',
    '- Indian foods are common here: dal, roti, idli, dosa, sambar, poha, upma, paneer, curd rice, biryani. Recognise them by name.',
    '- Numbers are integers. total must be the sum of items.',
    '- If the photo is unclear or has no food, return an empty items array and say so in note.',
    '- Be honest in confidence. Portion estimation from a photo is genuinely imprecise.'
  ].join('\n');

  const userText = 'Identify this meal and estimate its nutrition.'
    + (diet !== 'unspecified' ? ' The person eats ' + diet + '.' : '')
    + (hint ? ' They say it is: ' + hint : '');

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
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: userText }
          ]
        }]
      })
    });

    if (!res.ok) {
      const t = await res.text();
      return json({ error: 'Vision error: ' + t.slice(0, 300) }, res.status);
    }

    const data = await res.json();
    if (!data.content || !data.content[0]) return json({ error: 'Empty response' }, 500);

    let raw = data.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();

    let out;
    try { out = JSON.parse(raw); }
    catch { return json({ error: 'Could not read the result', rawSnippet: raw.slice(0, 250) }, 500); }

    return json(out);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
