import earnings from './earnings.js';
import {authorize} from './access.js';
import {accessPage} from './access-page.js';
import {acceptEvent, readStats, cleanupEvents} from './analytics.js';
import {fail, json, noStore, requireSameOrigin} from './http.js';

const privatePage = path => /^\/(?:stat-panel|statpanel|statistics-panel)(?:\/|$)/.test(path);
const privateAPI = path => /^\/(?:api|earnings-api)(?:\/|$)/.test(path);

export default {
  async fetch(request, env) {
    let path, url;
    try {
      url = new URL(request.url);
      path = decodeURIComponent(url.pathname);
      if (/[\\\u0000%]/.test(path)) fail('Некорректный адрес.');
      if (!env.CANONICAL_HOST || ![env.CANONICAL_HOST,...(env.PUBLIC_ALIASES || '').split(',').filter(Boolean)].includes(url.host)) {
        return json({error:'Неизвестный адрес сайта.'},404);
      }
      // A public recovery page contains no reports and remains reachable even
      // when a stale session or an unavailable database blocks the private UI.
      if (/^\/panel-login\/?$/.test(path)) {
        if (!['GET','HEAD'].includes(request.method)) return json({error:'Метод не поддерживается.'},405);
        if (url.host !== env.CANONICAL_HOST) {
          return noStore(Response.redirect(`https://${env.CANONICAL_HOST}/panel-login/`,302));
        }
        const reason = url.searchParams.get('reason');
        return accessPage(200, {reason:['expired','denied'].includes(reason) ? reason : 'entry',head:request.method === 'HEAD'});
      }
      const page = privatePage(path), api = privateAPI(path);
      if (!page && !api && path !== '/events') return env.ASSETS.fetch(request);
      if (!env.EARNINGS_DB) fail('Хранилище ещё не настроено.',503);
      if (path === '/events') return await acceptEvent(request,env);
      if (url.host !== env.CANONICAL_HOST) {
        if (page && ['GET','HEAD'].includes(request.method)) {
          return noStore(Response.redirect(`https://${env.CANONICAL_HOST}${url.pathname}${url.search}`,302));
        }
        fail('Используй основной адрес сайта.',421);
      }
      // Old bookmarks must reach the canonical Access-protected path before login.
      // This redirect contains no private data and never serves an asset.
      if (['GET','HEAD'].includes(request.method) && /^\/(?:statpanel|statistics-panel)(?:\/|$)/.test(path)) {
        const target = path.replace(/^\/(?:statpanel|statistics-panel)/,'/stat-panel');
        return noStore(Response.redirect(url.origin+(target === '/stat-panel' ? target+'/' : target)+url.search,302));
      }
      if (!['GET','HEAD','POST','PUT','DELETE'].includes(request.method)) fail('Метод не поддерживается.',405);
      if (!['GET','HEAD'].includes(request.method)) requireSameOrigin(request);
      const identity = await authorize(request,env);
      if (api) {
        if (path === '/api/stats') return await readStats(request,env.EARNINGS_DB);
        if (path === '/api/session' && request.method === 'GET') return json({ok:true,email:identity.email});
        if (path.startsWith('/earnings-api/')) return noStore(await earnings.fetch(request,env));
        return json({error:'Не найдено.'},404);
      }
      if (!['GET','HEAD'].includes(request.method)) fail('Метод не поддерживается.',405);
      if (path === '/stat-panel/login.html' || path === '/stat-panel/login') {
        return noStore(Response.redirect(url.origin+'/stat-panel/earnings.html',302));
      }
      // Assets remain behind the same signature check even if Access edge rules
      // are accidentally removed. Alternate percent-encoded paths are normalized.
      const assetURL = new URL(request.url);
      assetURL.pathname = path;
      const response = await env.ASSETS.fetch(new Request(assetURL,request));
      const secured = noStore(response);
      secured.headers.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; font-src 'self'; img-src 'self' data:; connect-src 'self'");
      return secured;
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status === 500) console.error('Request failed', {path, code:error.code || error.name});
      if (path && privatePage(path) && request.headers.get('Accept')?.includes('text/html')) {
        return accessPage(status, {head:request.method === 'HEAD'});
      }
      return json({error:status===500?'Внутренняя ошибка сервера.':error.message},status);
    }
  },
  async scheduled(_event,env) { await cleanupEvents(env.EARNINGS_DB); },
};
