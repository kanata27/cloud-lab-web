// Access keeps its session in an HttpOnly cookie, not in JavaScript storage.
// Clean up the old AWS token without reusing it as an authentication fallback.
try { sessionStorage.removeItem('kanata_admin_token'); } catch {}

export function sessionEnded() {
  for (const id of ['app','dashboard','report']) {
    const element = document.getElementById(id);
    if (element) element.hidden = true;
  }
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  location.replace('/stat-panel/login.html');
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
  const response = await fetch(target, {...options,credentials:'same-origin',cache:'no-store',redirect:'manual'});
  if ([0,301,302,303,307,308,401].includes(response.status) || response.type === 'opaqueredirect') {
    sessionEnded();
    throw new Error('Сессия истекла. Войди заново.');
  }
  if (response.status === 403) throw new Error('Нет доступа к панели. Проверь разрешённый аккаунт.');
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
