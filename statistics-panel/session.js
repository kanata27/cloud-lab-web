// Access keeps its session in an HttpOnly cookie, not in JavaScript storage.
// Clean up the old AWS token without reusing it as an authentication fallback.
try { sessionStorage.removeItem('kanata_admin_token'); } catch {}

export function sessionEnded(reason = 'expired') {
  for (const id of ['app','dashboard','report']) {
    const element = document.getElementById(id);
    if (element) element.hidden = true;
  }
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  // Never automatically bounce a stale identity between Access and a protected
  // login asset. This public screen always offers an explicit session reset.
  location.replace('/panel-login/?reason=' + (reason === 'denied' ? 'denied' : 'expired'));
}

export function logout(event) {
  event?.preventDefault?.();
  for (const id of ['app','dashboard','report']) {
    const element = document.getElementById(id);
    if (element) element.hidden = true;
  }
  location.assign('/cdn-cgi/access/logout');
}

export async function accessFetch(url, options = {}) {
  const target = new URL(url,location.origin);
  if (target.origin !== location.origin) throw new Error('Запрос к другому сайту запрещён.');
  const headers = new Headers(options.headers);
  headers.set('X-Requested-With','XMLHttpRequest');
  const response = await fetch(target, {...options,headers,credentials:'same-origin',cache:'no-store',redirect:'manual'});
  if ([0,301,302,303,307,308,401].includes(response.status) || response.type === 'opaqueredirect') {
    sessionEnded();
    throw new Error('Сессия истекла. Войди заново.');
  }
  if (response.status === 403) {
    sessionEnded('denied');
    throw new Error('Этот аккаунт не допущен к панели. Войди другим аккаунтом.');
  }
  return response;
}

window.addEventListener('pagehide',()=>{
  // A history/back navigation must not briefly reveal a previously rendered report.
  for (const id of ['app','dashboard']) {
    const element = document.getElementById(id);
    if (element) element.hidden = true;
  }
});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
