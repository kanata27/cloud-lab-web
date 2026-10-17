export function fail(message, status = 400) { throw Object.assign(new Error(message), {status}); }

export const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

export function json(data, status = 200) {
  return Response.json(data, {status, headers: {...PRIVATE_HEADERS,
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"}});
}

export async function body(request, maximum = 16000) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) fail('Ожидается JSON.', 415);
  if (Number(request.headers.get('Content-Length') || 0) > maximum) fail('Слишком большая запись.', 413);
  const reader = request.body?.getReader();
  if (!reader) fail('Пустой запрос.');
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); fail('Слишком большая запись.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer)); }
  catch { fail('Некорректный JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Ожидается объект записи.');
  return data;
}

export function requireSameOrigin(request) {
  const origin = new URL(request.url).origin;
  if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    fail('Запрос с другого сайта запрещён.', 403);
  }
}

export function noStore(response) {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) secured.headers.set(name, value);
  secured.headers.set('Vary', 'Cookie, Cf-Access-Jwt-Assertion');
  return secured;
}
