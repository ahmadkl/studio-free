// Optional: your own free image endpoint on Cloudflare Workers AI (FLUX schnell).
// Setup (from the Cloudflare dashboard, works on a phone browser):
//   1) Workers & Pages -> Create -> Worker -> paste this file -> Deploy
//   2) Worker -> Settings -> Bindings -> Add -> Workers AI -> variable name: AI
//   3) (optional) Settings -> Variables -> add SECRET = any password
//   4) Paste the worker URL (and the password) into the app's Settings tab.
// The free plan has a daily allowance; the app does not control it.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST') return new Response('POST only', { status: 405, headers: CORS });
    if (env.SECRET && req.headers.get('authorization') !== `Bearer ${env.SECRET}`) {
      return new Response('unauthorized', { status: 401, headers: CORS });
    }
    let body;
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400, headers: CORS }); }
    const prompt = String(body.prompt || '').slice(0, 2000);
    if (!prompt) return new Response('prompt required', { status: 400, headers: CORS });

    const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt, steps: 4 });
    return Response.json({ image: out.image }, { headers: CORS });
  },
};
