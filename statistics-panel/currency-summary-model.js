import {dateValid} from './earnings-model.js';

const safeAmount = value => Number.isSafeInteger(value) && value >= 0;

// Stored amounts use hundredths of their original currency, including JPY.
// Keep those integers throughout aggregation; do not use saved CZK totals.
export function sumForeignAmounts(entries) {
  if (!Array.isArray(entries)) throw new Error('Не удалось прочитать валюты выступлений.');
  const totals = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry?.amounts)) throw new Error('В выступлении отсутствуют суммы валют.');
    const seen = new Set();
    for (const row of entry.amounts) {
      if (!row || !/^[A-Z]{3}$/.test(row.currency) || !safeAmount(row.minor) || seen.has(row.currency)) {
        throw new Error('В суммах валют обнаружена ошибка.');
      }
      seen.add(row.currency);
      if (row.currency === 'CZK' || row.minor === 0) continue;
      const minor = (totals.get(row.currency) || 0) + row.minor;
      if (!safeAmount(minor)) throw new Error('Сумма валюты превышает допустимый размер.');
      totals.set(row.currency, minor);
    }
  }
  const ordered = ['EUR', 'USD', ...[...totals.keys()].filter(currency => !['EUR', 'USD'].includes(currency))];
  return ordered.filter(currency => totals.has(currency)).map(currency => ({currency, minor: totals.get(currency)}));
}

export function valueForeignAmounts(totals, snapshot, asOf) {
  if (!dateValid(asOf) || snapshot?.requestedDate !== asOf || snapshot.rates?.CZK !== 1
      || !dateValid(snapshot.dates?.CZK) || snapshot.dates.CZK > asOf) {
    throw new Error('Не удалось прочитать текущий курс.');
  }
  const dates = new Set([snapshot.dates.CZK]);
  const values = totals.map(total => {
    const rate = snapshot.rates[total.currency], date = snapshot.dates[total.currency];
    if (!Number.isFinite(rate) || rate <= 0 || !dateValid(date) || date > asOf) {
      return {...total, czkMinor: null, date: null};
    }
    const czkMinor = Math.round(total.minor * rate);
    if (!safeAmount(czkMinor)) return {...total, czkMinor: null, date: null};
    dates.add(date);
    return {...total, czkMinor, date};
  });
  return {values, dates: [...dates].sort()};
}
