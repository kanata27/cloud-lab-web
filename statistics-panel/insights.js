import {DateFilters, fullDate} from './date-filter.js';
import {splitRanges, validateTrafficReport, buildInsights, byWeeks, axisScale} from './insights-model.js';

const $ = id => document.getElementById(id);
const tokenKey = 'kanata_admin_token';
const integer = new Intl.NumberFormat('ru-RU');
const amount = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2});
const hourly = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});
const shortDate = value => new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', timeZone: 'UTC'})
  .format(new Date(value + 'T12:00:00Z')).replaceAll('.', '');
let filters, report = null, controller = null, group = 'days', chart = null, hovered = null;

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}
function svgNode(tag, attributes = {}, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
function message(text, error = false) {
  $('message').textContent = text;
  $('message').hidden = !text;
  $('message').classList.toggle('error', error);
  $('message').setAttribute('role', error ? 'alert' : 'status');
}
function expire() {
  controller?.abort();
  sessionStorage.removeItem(tokenKey);
  report = chart = null;
  $('app').hidden = true;
  $('report').hidden = true;
  $('insights-chart').querySelector('svg')?.remove();
  hideTooltip();
  location.replace('/stat-panel/login.html');
}
async function readJSON(url, signal, label) {
  const token = sessionStorage.getItem(tokenKey);
  if (!token) { expire(); throw new Error('Войди в панель заново.'); }
  const response = await fetch(url, {
    cache: 'no-store', credentials: 'omit',
    headers: {Accept: 'application/json', Authorization: `Bearer ${token}`},
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  });
  if (response.status === 401 || response.status === 403) { expire(); throw new Error('Сессия истекла.'); }
  if (!response.ok) throw new Error(`Не удалось загрузить ${label}. Попробуй ещё раз.`);
  try { return await response.json(); }
  catch { throw new Error(`Сервис ${label} вернул некорректный ответ.`); }
}

async function load() {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  report = chart = null;
  hideTooltip();
  $('report').hidden = true;
  $('insights-chart').querySelector('svg')?.remove();
  $('show').disabled = true;
  $('app').setAttribute('aria-busy', 'true');
  message('Загружаем заработки и посещения…');
  try {
    const selection = filters.selection();
    const ranges = splitRanges(selection.from, selection.to);
    const [traffic, earnings] = await Promise.all([
      Promise.all(ranges.map(async range => {
        const query = new URLSearchParams({...range, source: 'all'});
        const data = await readJSON(`${window.KANATA_CONFIG.apiBase}/stats?${query}`, request.signal, 'посещения');
        return validateTrafficReport(data, range);
      })),
      readJSON('/earnings-api/entries?' + new URLSearchParams({...selection, spot: ''}), request.signal, 'заработки'),
    ]);
    if (request !== controller || request.signal.aborted) return;
    report = buildInsights({...selection, traffic, entries: earnings.entries});
    const {totals} = report;
    $('total-czk').textContent = amount.format(totals.czkMinor / 100) + ' Kč';
    $('hour-czk').replaceChildren(...(totals.hourCzk === null ? [node('span', '—')]
      : [document.createTextNode(hourly.format(totals.hourCzk) + ' '), node('span', 'Kč/ч')]));
    $('views-value').textContent = integer.format(totals.views);
    $('youtube-value').textContent = integer.format(totals.youtube);
    $('instagram-value').textContent = integer.format(totals.instagram);
    $('report').hidden = false;
    message('');
    drawChart();
  } catch (error) {
    if (request !== controller || request.signal.aborted) return;
    request.abort();
    message(error.name === 'TimeoutError' ? 'Сервис не ответил вовремя. Нажми «Показать», чтобы повторить.' : error.message, true);
  } finally {
    if (request === controller) { $('show').disabled = false; $('app').removeAttribute('aria-busy'); }
  }
}

function drawChart() {
  if (!report || $('report').hidden) return;
  const host = $('insights-chart');
  const width = host.clientWidth, height = host.clientHeight;
  if (width < 150) return;
  const data = group === 'weeks' ? byWeeks(report.daily) : report.daily;
  const moneyScale = axisScale(data.map(row => row.czkMinor / 100));
  const viewScale = axisScale(data.map(row => row.views), true);
  const small = width < 500;
  const fontWidth = small ? 6 : 7;
  const pad = {left: Math.max(42, amount.format(moneyScale.max).length * fontWidth + 12), right: Math.max(30, integer.format(viewScale.max).length * fontWidth + 12), top: 38, bottom: 34};
  const plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom;
  const step = plotWidth / data.length;
  const x = index => pad.left + step * (index + .5);
  const moneyY = value => pad.top + plotHeight * (1 - value / moneyScale.max);
  const viewsY = value => pad.top + plotHeight * (1 - value / viewScale.max);
  const svg = svgNode('svg', {viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': 'graph-title graph-description'});
  svg.append(svgNode('title', {id: 'graph-title'}, 'Заработок и просмотры ' + (group === 'weeks' ? 'по неделям' : 'по дням')));
  svg.append(svgNode('desc', {id: 'graph-description'}, 'Зелёные столбцы — заработок в кронах, синяя линия — просмотры. У каждой серии своя шкала с нулём. В режиме недель показаны суммы с понедельника по воскресенье, в пределах выбранного периода.'));
  svg.append(svgNode('text', {x: 0, y: 14, class: 'chart-axis chart-unit'}, group === 'weeks' && !small ? 'Заработок за неделю, Kč' : 'Заработок, Kč'));
  svg.append(svgNode('text', {x: width, y: 14, 'text-anchor': 'end', class: 'chart-axis chart-unit'}, group === 'weeks' && !small ? 'Просмотры за неделю' : 'Просмотры'));
  const highlight = svgNode('rect', {y: pad.top, height: plotHeight, width: step, class: 'chart-hover', visibility: 'hidden'});
  svg.append(highlight);
  moneyScale.ticks.forEach((tick, index) => {
    const y = moneyY(tick);
    svg.append(svgNode('line', {x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: 'chart-grid'}));
    svg.append(svgNode('text', {x: pad.left - 9, y: y + 4, 'text-anchor': 'end', class: 'chart-axis'}, amount.format(tick)));
    svg.append(svgNode('text', {x: width - pad.right + 8, y: y + 4, class: 'chart-axis'}, integer.format(viewScale.ticks[index])));
  });
  const barWidth = Math.min(group === 'weeks' ? 64 : 48, step * .62);
  data.forEach((row, index) => {
    const y = moneyY(row.czkMinor / 100);
    svg.append(svgNode('rect', {x: x(index) - barWidth / 2, y, width: barWidth, height: height - pad.bottom - y, class: 'chart-income', 'data-from': row.from, 'data-to': row.to}));
  });
  svg.append(svgNode('path', {d: data.map((row, index) => `${index ? 'L' : 'M'}${x(index)},${viewsY(row.views)}`).join(' '), class: 'chart-views'}));
  if (group === 'weeks' || data.length === 1) data.forEach((row, index) => {
    svg.append(svgNode('circle', {cx: x(index), cy: viewsY(row.views), r: small ? 3 : 4, class: 'chart-point'}));
  });
  const marker = svgNode('circle', {r: 5, class: 'chart-point', visibility: 'hidden'});
  svg.append(marker);
  const maxLabels = Math.max(2, Math.floor(plotWidth / (group === 'weeks' ? 70 : 145)));
  const labels = Math.min(data.length, maxLabels);
  for (let index = 0; index < labels; index++) {
    const position = labels === 1 ? 0 : Math.round(index / (labels - 1) * (data.length - 1));
    svg.append(svgNode('text', {x: x(position), y: height - 8, 'text-anchor': labels === 1 ? 'middle' : index === 0 ? 'start' : index === labels - 1 ? 'end' : 'middle', class: 'chart-axis'}, shortDate(data[position].from)));
  }
  host.querySelector('svg')?.remove();
  host.prepend(svg);
  chart = {data, svg, highlight, marker, x, viewsY, moneyY, pad, plotWidth, step, width, height};
  if (hovered !== null) showTooltip(Math.min(hovered, data.length - 1));
}

function hideTooltip() {
  hovered = null;
  $('chart-tooltip').hidden = true;
  chart?.highlight.setAttribute('visibility', 'hidden');
  chart?.marker.setAttribute('visibility', 'hidden');
}
function showTooltip(index, announce = false) {
  if (!chart) return;
  hovered = Math.max(0, Math.min(chart.data.length - 1, index));
  const row = chart.data[hovered], tooltip = $('chart-tooltip');
  const title = row.from === row.to ? fullDate(row.from) : `${shortDate(row.from)} – ${fullDate(row.to)}`;
  const values = [['Заработок', amount.format(row.czkMinor / 100) + ' Kč'], ['Просмотры', integer.format(row.views)], ['Переходы', integer.format(row.youtube + row.instagram)]];
  const list = node('dl');
  values.forEach(([name, value]) => list.append(node('dt', name), node('dd', value)));
  tooltip.replaceChildren(node('strong', title), list);
  tooltip.hidden = false;
  const x = chart.x(hovered), y = chart.viewsY(row.views);
  chart.highlight.setAttribute('x', x - chart.step / 2);
  chart.highlight.setAttribute('visibility', 'visible');
  chart.marker.setAttribute('cx', x);
  chart.marker.setAttribute('cy', y);
  chart.marker.setAttribute('visibility', 'visible');
  const box = tooltip.getBoundingClientRect();
  const left = Math.max(8, Math.min(x + 14, chart.width - box.width - 8));
  const top = Math.max(24, Math.min(Math.min(y, chart.moneyY(row.czkMinor / 100)) - box.height - 12, chart.height - box.height - 8));
  tooltip.style.left = left + 'px';
  tooltip.style.top = top + 'px';
  if (announce) $('chart-announcement').textContent = `${title}. ${values.map(([name, value]) => `${name}: ${value}`).join('. ')}.`;
}
function pointIndex(event) {
  const box = chart.svg.getBoundingClientRect();
  const coordinate = (event.clientX - box.left) * chart.width / box.width;
  return Math.max(0, Math.min(chart.data.length - 1, Math.floor((coordinate - chart.pad.left) / chart.step)));
}

$('insights-chart').addEventListener('pointermove', event => {
  if (chart && event.pointerType !== 'touch') showTooltip(pointIndex(event));
});
$('insights-chart').addEventListener('click', event => { if (chart) showTooltip(pointIndex(event), true); });
$('insights-chart').addEventListener('pointerleave', () => { if (document.activeElement !== $('insights-chart')) hideTooltip(); });
$('insights-chart').addEventListener('focus', () => { if (chart) showTooltip(hovered ?? chart.data.length - 1, true); });
$('insights-chart').addEventListener('blur', hideTooltip);
$('insights-chart').addEventListener('keydown', event => {
  if (!chart) return;
  if (event.key === 'Escape') { event.preventDefault(); hideTooltip(); return; }
  const current = hovered ?? 0;
  const index = {ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: chart.data.length - 1}[event.key];
  if (index === undefined) return;
  event.preventDefault(); showTooltip(index, true);
});
document.querySelectorAll('[data-group]').forEach(button => button.addEventListener('click', () => {
  group = button.dataset.group;
  document.querySelectorAll('[data-group]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  hideTooltip(); drawChart();
}));
$('logout').addEventListener('click', expire);
window.addEventListener('pageshow', event => { if (event.persisted && !sessionStorage.getItem(tokenKey)) expire(); });
new ResizeObserver(() => drawChart()).observe($('insights-chart'));
if (!sessionStorage.getItem(tokenKey)) expire();
else {
  // /stats currently supplies UTC daily buckets; keep its date boundaries.
  filters = new DateFilters({timeZone: 'UTC', onChange: load});
  $('app').hidden = false;
  load();
}
