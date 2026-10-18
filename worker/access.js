import {jwtVerify, createRemoteJWKSet, customFetch} from 'jose';
import {fail} from './http.js';

const keySets = new Map();

export function accessSettings(env) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  // Keep existing deployments working until the plural secret is configured.
  // A present but invalid new value must never fall back to an older allowlist.
  const configured = env.ACCESS_ALLOWED_EMAILS === undefined ? env.ACCESS_ALLOWED_EMAIL : env.ACCESS_ALLOWED_EMAILS;
  const values = typeof configured === 'string' && configured.length <= 4096
    ? configured.split(',').map(value => value.trim().toLowerCase()) : [];
  const emails = new Set(values);
  if (typeof team !== 'string' || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(team)
      || typeof audience !== 'string' || !/^[a-f0-9]{64}$/i.test(audience)
      || values.length < 1 || values.length > 8
      || values.some(email => email.length > 254 || !/^[^\s@,;*<>]+@[^\s@,;*<>]+\.[^\s@,;*<>]+$/.test(email))) {
    fail('Доступ к панели ещё не настроен.', 503);
  }
  return {team, audience, emails};
}

export async function authorize(request, env) {
  const {team, audience, emails} = accessSettings(env);
  // A decoded token or an email header is never proof of identity.
  // No bearer-token, service-token, or development bypass exists.
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) fail('Требуется вход через Cloudflare Access.', 401);
  let keys = keySets.get(team);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(team + '/cdn-cgi/access/certs'), {
      timeoutDuration: 5000,
      cooldownDuration: 30000,
      cacheMaxAge: 600000,
      [customFetch]: async (url, options) => {
        let response;
        try { response = await fetch(url, {...options, redirect: 'manual'}); }
        catch { fail('Сервис проверки входа временно недоступен.', 503); }
        if (response.status !== 200) fail('Сервис проверки входа временно недоступен.', 503);
        return response;
      },
    });
    keySets.set(team, keys);
  }
  let payload;
  try {
    ({payload} = await jwtVerify(token, keys, {
      algorithms: ['RS256'], issuer: team, audience,
      requiredClaims: ['exp', 'iat', 'sub', 'email'], maxTokenAge: '8h',
    }));
  } catch (error) {
    if (error.status === 503 || error.code === 'ERR_JWKS_TIMEOUT') fail('Сервис проверки входа временно недоступен.', 503);
    fail('Сессия истекла или недействительна.', 401);
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (payload.type !== 'app' || !emails.has(email)) fail('Этот аккаунт не допущен к панели.', 403);
  return {email, subject: payload.sub};
}
