import {dateValid, plusDays, today, weekdayIndex} from './earnings-model.js';

const safe = value => Number.isSafeInteger(value) && value >= 0;

export function buildEarningsCalendar(data, year, asOf = today()) {
  if (!dateValid(asOf) || !Number.isInteger(year) || year < 2000 || year > Number(asOf.slice(0, 4))
      || data?.year !== year || !Array.isArray(data.days)) {
    throw new Error('Не удалось прочитать годовой календарь.');
  }
  const first = `${year}-01-01`, last = `${year}-12-31`, records = new Map();
  for (const row of data.days) {
    if (!dateValid(row?.date) || row.date < first || row.date > last || row.date > asOf || records.has(row.date)
        || !safe(row.czkMinor) || !safe(row.eurMinor) || !safe(row.minutes) || !safe(row.count)
        || row.count < 1 || row.minutes < row.count || row.minutes > row.count * 1440
        || !Array.isArray(row.spots) || !row.spots.length || row.spots.length > row.count
        || new Set(row.spots).size !== row.spots.length
        || row.spots.some(name => typeof name !== 'string' || !name.trim() || name.length > 80 || /[\u0000-\u001f]/.test(name))) {
      throw new Error('В годовой статистике заработков обнаружена ошибка.');
    }
    records.set(row.date, row);
  }
  const days = [];
  let activeDays = 0, count = 0, minutes = 0, czkMinor = 0;
  for (let date = first; date <= last; date = plusDays(date, 1)) {
    const row = records.get(date);
    if (row) { activeDays++; count += row.count; minutes += row.minutes; czkMinor += row.czkMinor; }
    days.push({date, count: row?.count || 0, minutes: row?.minutes || 0, spots: row?.spots || [],
      czkMinor: row?.czkMinor || 0, eurMinor: row?.eurMinor || 0,
      hourCzk: row ? row.czkMinor / 100 * 60 / row.minutes : null,
      hourEur: row ? row.eurMinor / 100 * 60 / row.minutes : null, future: date > asOf});
  }
  if (![count, minutes, czkMinor].every(safe)) throw new Error('Годовые показатели превышают допустимый размер.');
  const peak = Math.max(0, ...days.map(day => day.hourCzk || 0));
  for (const day of days) {
    // Empty days stay neutral; a played day earning zero still has a faint tint.
    day.level = day.count ? peak ? Math.max(1, Math.min(4, Math.ceil(day.hourCzk / peak * 4))) : 1 : 0;
  }
  const offset = weekdayIndex(first), weeks = Math.ceil((offset + days.length) / 7);
  const cells = Array.from({length: weeks * 7}, (_, index) => days[index - offset] || null);
  const months = days.filter(day => day.date.endsWith('-01')).map(day => ({
    month: Number(day.date.slice(5, 7)) - 1,
    column: Math.floor((offset + (Date.parse(day.date) - Date.parse(first)) / 86400000) / 7) + 1,
  }));
  return {year, days, cells, months, weeks, peak, activeDays, count, minutes, czkMinor};
}
