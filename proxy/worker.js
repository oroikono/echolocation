// Cloudflare Worker proxy for the Claude scene-discussion feature.
// Holds the Anthropic API key server-side so it NEVER ships to the browser.
//
// Deploy:
//   npm i -g wrangler
//   cd proxy
//   wrangler login
//   wrangler secret put ANTHROPIC_API_KEY      # paste your sk-ant-... once
//   wrangler deploy                            # -> https://echo-claude-proxy.<you>.workers.dev
//
// Then in the web app set:
//   endpoint: 'https://echo-claude-proxy.<you>.workers.dev',
//   getApiKey: () => null
//
// Lock ALLOW_ORIGIN to your Pages origin before sharing publicly.

const ALLOW_ORIGIN = '*'; // e.g. 'https://oroikono.github.io'

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (req.method !== 'POST') return cors(new Response('POST only', { status: 405 }));

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: await req.text(),     // forward the JSON (image + history) as-is
    });

    // Pass the response (including the SSE stream) straight back to the browser.
    return cors(new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' },
    }));
  },
};

function cors(r) {
  r.headers.set('access-control-allow-origin', ALLOW_ORIGIN);
  r.headers.set('access-control-allow-headers', 'content-type');
  r.headers.set('access-control-allow-methods', 'POST,OPTIONS');
  return r;
}
