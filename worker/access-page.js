import {noStore} from './http.js';

const states = Object.freeze({
  entry: {
    title: 'Вход в панель',
    message: 'Введи свой email и подтверди вход кодом из письма.',
    detail: 'На следующем экране можно запросить код на почту.',
    primary: 'Войти в панель', href: '/stat-panel/',
    secondary: 'Сбросить сессию', secondaryHref: '/cdn-cgi/access/logout',
  },
  expired: {
    title: 'Войди заново',
    message: 'Сессия завершилась или её не удалось подтвердить.',
    detail: 'Сбрось текущую сессию и запроси новый код на почту.',
    primary: 'Сбросить сессию и войти', href: '/cdn-cgi/access/logout',
    secondary: 'Повторить вход', secondaryHref: '/stat-panel/',
  },
  denied: {
    title: 'Этот email не допущен',
    message: 'Адрес подтверждён, но ему не разрешён доступ к панели.',
    detail: 'Сбрось текущую сессию и войди с разрешённого email.',
    primary: 'Сбросить сессию и войти', href: '/cdn-cgi/access/logout',
    secondary: 'Повторить вход', secondaryHref: '/stat-panel/',
  },
  unavailable: {
    title: 'Вход временно недоступен',
    message: 'Не удалось проверить доступ. Данные панели не загружены.',
    detail: 'Попробуй ещё раз немного позже.',
    primary: 'Повторить вход', href: '/stat-panel/',
    secondary: 'Сбросить сессию', secondaryHref: '/cdn-cgi/access/logout',
  },
  error: {
    title: 'Не удалось открыть панель',
    message: 'Запрос не удалось выполнить. Попробуй открыть панель ещё раз.',
    detail: 'Чтобы запросить новый код на почту, сначала сбрось текущую сессию.',
    primary: 'Открыть панель', href: '/stat-panel/',
    secondary: 'Сбросить сессию', secondaryHref: '/cdn-cgi/access/logout',
  },
});

const styles = `
:root{color-scheme:light dark;--bg:#efede8;--panel:#faf9f6;--ink:#252925;--muted:#686d66;--line:#d8d9d1;--accent:#4e7261;--on-accent:#fff}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;padding:24px}
main{width:100%;max-width:560px;padding:clamp(24px,5vw,44px);border:1px solid var(--line);border-radius:18px;background:var(--panel)}
.brand{margin:0 0 32px;font:bold 40px/1 Georgia,serif;letter-spacing:-2px}h1{font-size:clamp(26px,6vw,36px);line-height:1.2;letter-spacing:-1px;font-weight:550;margin:0 0 20px}p{margin:0 0 16px;overflow-wrap:anywhere}.detail{font-size:14px;color:var(--muted)}
.actions{display:grid;gap:12px;margin-top:28px}a{color:inherit;text-underline-offset:4px}a:focus-visible{outline:3px solid var(--accent);outline-offset:4px}.action{display:flex;align-items:center;justify-content:center;min-height:48px;border:1px solid var(--line);border-radius:9px;padding:12px 16px;text-decoration:none;text-align:center;font-size:15px;font-weight:500;line-height:1.5}.primary{background:var(--ink);color:var(--panel);border-color:var(--ink)}.action:hover{border-color:var(--accent)}.primary:hover{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}.home{display:inline-block;margin-top:24px;font-size:14px;color:var(--muted)}
@media(prefers-color-scheme:dark){:root{--bg:#191d1a;--panel:#242925;--ink:#f1f0e8;--muted:#b5b9af;--line:#424b43;--accent:#71927e}}
@media(max-width:360px){body{padding:16px}main{padding:24px 20px}}
`;

// All content and destinations are fixed. No query value, token or configured
// email is reflected into this unauthenticated page. Recovery needs no JS/assets.
export function accessPage(status = 200, {reason, head = false} = {}) {
  const fallback = status === 200 ? 'entry' : status === 401 ? 'expired'
    : status === 403 ? 'denied' : status === 503 ? 'unavailable' : 'error';
  const state = states[Object.hasOwn(states, reason) ? reason : fallback];
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>kanata · ${state.title}</title><style nonce="${nonce}">${styles}</style></head><body><main><p class="brand">kanata</p><h1>${state.title}</h1><p>${state.message}</p><p class="detail">${state.detail}</p><nav class="actions" aria-label="Вход в панель"><a class="action primary" href="${state.href}">${state.primary}</a><a class="action" href="${state.secondaryHref}">${state.secondary}</a></nav><a class="home" href="/">На главную</a></main></body></html>`;
  return noStore(new Response(head ? null : html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; style-src 'nonce-${nonce}'`,
    },
  }));
}
