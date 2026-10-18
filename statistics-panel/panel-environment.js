const header = document.querySelector('.masthead');

if (location.hostname === 'preview.kanata27.com' && header) {
  const container = document.createElement('div');
  container.className = 'preview-environment';
  const badge = document.createElement('span');
  badge.className = 'preview-badge';
  badge.setAttribute('role', 'note');
  badge.setAttribute('aria-label', 'Тестовая версия');
  badge.title = 'Тестовая версия · preview.kanata27.com';
  for (const [className, text] of [['preview-label-full', 'ТЕСТОВАЯ ВЕРСИЯ'], ['preview-label-short', 'ТЕСТ']]) {
    const label = document.createElement('span');
    label.className = className;
    label.textContent = text;
    label.setAttribute('aria-hidden', 'true');
    badge.append(label);
  }
  container.append(badge);
  header.insertBefore(container, header.querySelector('#logout'));
  document.title = 'Тест · ' + document.title;
}
