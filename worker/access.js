import {jwtVerify, createRemoteJWKSet, customFetch} from 'jose';
import {fail} from './http.js';

const keySets = new Map();

export function accessSettings(env) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  const email = env.ACCESS_ALLOWED_EMAIL?.trim().toLowerCase();
  if (typeof team !== 'string' || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(team)
      || typeof audience !== 'string' || !/^[a-f0-9]{64}$/i.test(audience)
      || !email || email.length > 254 || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) {
    fail('Доступ к панели ещё не настроен.', 503);
  }
  return {team, audience, email};
}

export async function authorize(request, env) {
  const {team, audience, email} = accessSettings(env);
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
  if (payload.type !== 'app' || typeof payload.email !== 'string'
      || payload.email.trim().toLowerCase() !== email) fail('Нет доступа к этой панели.', 403);
  return {email, subject: payload.sub};
}
