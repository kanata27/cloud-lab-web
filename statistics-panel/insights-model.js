import {dateValid, plusDays} from './earnings-model.js';

const DAY = 86400000;
const trafficFields = ['page_views', 'outbound_clicks', 'youtube', 'instagram'];
const count = value => Number.isSafeInteger(value) && value >= 0;

function rangeLength(from, to) {
  if (!dateValid(from) || !dateValid(to) || from > to) throw new Error('Проверь выбранный период.');
  const length = (Date.parse(to) - Date.parse(from)) / DAY + 1;
  if (length > 367) throw new Error('Выбери период не длиннее года.');
  return length;
}

export function splitRanges(from, to, maxDays = 90) {
  rangeLength(from, to);
  if (!Number.isInteger(maxDays) || maxDays < 1) throw new Error('Некорректный размер периода.');
  const ranges = [];
  for (let start = from; start <= to;) {
    const end = plusDays(start, maxDays - 1);
    ranges.push({from: start, to: end < to ? end : to});
    start = plusDays(ranges.at(-1).to, 1);
  }
  return ranges;
}

export function validateTrafficReport(data, selection) {
  const days = rangeLength(selection.from, selection.to);
  if (data?.version !== 1 || data.range?.from !== selection.from || data.range?.to !== selection.to
      || data.range?.source !== 'all' || data.range?.time_zone !== 'UTC'
      || !Number.isFinite(Date.parse(data.generated_at)) || !Array.isArray(data.daily)
      || data.daily.length !== days || !trafficFields.every(key => count(data.totals?.[key]))) {
    throw new Error('API посещений вернул отчёт в неожиданном формате.');
  }
  const totals = Object.fromEntries(trafficFields.map(key => [key, 0]));
  for (const [index, row] of data.daily.entries()) {
    if (row?.date !== plusDays(selection.from, index) || !trafficFields.every(key => count(row[key]))
        || row.outbound_clicks !== row.youtube + row.instagram) {
      throw new Error('В ежедневной статистике посещений обнаружена ошибка.');
    }
    for (const key of trafficFields) totals[key] += row[key];
  }
  if (!trafficFields.every(key => count(totals[key]) && totals[key] === data.totals[key])) {
    throw new Error('Суммы посещений за период и по дням не совпадают.');
  }
  return data;
}

export function buildInsights({from, to, traffic, entries}) {
  const days = rangeLength(from, to);
  if (!Array.isArray(traffic) || !Array.isArray(entries)) throw new Error('Не удалось прочитать данные отчёта.');
  const rows = new Map(Array.from({length: days}, (_, index) => {
    const date = plusDays(from, index);
    return [date, {from: date, to: date, czkMinor: 0, minutes: 0, views: 0, youtube: 0, instagram: 0}];
  }));
  const seenDates = new Set();
  for (const report of traffic) {
    validateTrafficReport(report, report.range);
    for (const day of report.daily) {
      const row = rows.get(day.date);
      if (!row || seenDates.has(day.date)) throw new Error('Периоды посещений пересекаются или выходят за выбранные даты.');
      seenDates.add(day.date);
      row.views = day.page_views;
      row.youtube = day.youtube;
      row.instagram = day.instagram;
    }
  }
  if (seenDates.size !== days) throw new Error('Получена неполная статистика посещений. Попробуй ещё раз.');
  const seenEntries = new Set();
  for (const entry of entries) {
    const row = rows.get(entry?.date);
    if (!row || typeof entry.id !== 'string' || seenEntries.has(entry.id)
        || !count(entry.czkMinor) || !Number.isInteger(entry.minutes) || entry.minutes < 1 || entry.minutes > 1440) {
      throw new Error('В данных заработков обнаружена ошибка.');
    }
    seenEntries.add(entry.id);
    row.czkMinor += entry.czkMinor;
    row.minutes += entry.minutes;
  }
  const daily = [...rows.values()];
  const totals = daily.reduce((sum, row) => {
    for (const key of ['czkMinor', 'minutes', 'views', 'youtube', 'instagram']) sum[key] += row[key];
    return sum;
  }, {czkMinor: 0, minutes: 0, views: 0, youtube: 0, instagram: 0});
  if (!Object.values(totals).every(count)) throw new Error('Показатели отчёта превышают допустимый размер.');
  totals.hourCzk = totals.minutes ? totals.czkMinor / 100 * 60 / totals.minutes : null;
  return {from, to, daily, totals};
}

export function byWeeks(daily) {
  const weeks = new Map();
  for (const day of daily) {
    const weekday = (new Date(day.from + 'T00:00:00Z').getUTCDay() + 6) % 7;
    const monday = plusDays(day.from, -weekday);
    if (!weeks.has(monday)) weeks.set(monday, {from: day.from, to: day.to, czkMinor: 0, minutes: 0, views: 0, youtube: 0, instagram: 0});
    const week = weeks.get(monday);
    week.to = day.to;
    for (const key of ['czkMinor', 'minutes', 'views', 'youtube', 'instagram']) week[key] += day[key];
  }
  return [...weeks.values()];
}

export function axisScale(values, integerOnly = false) {
  const peak = Math.max(1, ...values);
  const raw = peak * 1.04 / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const multiplier = [1, 2, 2.5, 5, 10].find(value => value * power >= raw);
  const step = integerOnly ? Math.max(1, Math.ceil(multiplier * power)) : multiplier * power;
  return {max: step * 5, ticks: Array.from({length: 6}, (_, index) => Number((step * index).toPrecision(12)))};
}
