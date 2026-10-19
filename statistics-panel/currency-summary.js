import {today} from './earnings-model.js';
import {sumForeignAmounts, valueForeignAmounts} from './currency-summary-model.js';

const $ = id => document.getElementById(id);
const names = new Intl.DisplayNames(['ru'], {type: 'currency'});
const friendlyNames = {EUR: 'Евро', USD: 'Доллары США', JPY: 'Японские иены',
  GBP: 'Фунты стерлингов', PLN: 'Польские злотые', CHF: 'Швейцарские франки', HUF: 'Венгерские форинты'};
const czk = new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const dateLabel = date => date.split('-').reverse().join('.');
const HOUR = 3600000;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function originalAmount({currency, minor}) {
  const options = {style: 'currency', currency, currencyDisplay: 'narrowSymbol'};
  const digits = new Intl.NumberFormat('ru-RU', options).resolvedOptions().maximumFractionDigits;
  return new Intl.NumberFormat('ru-RU', {...options, maximumFractionDigits: Math.max(2, digits)}).format(minor / 100);
}

export class CurrencySummary {
  constructor({read}) {
    this.read = read;
    this.totals = [];
    this.values = [];
    this.expanded = false;
    this.request = null;
    this.cached = null;
    this.loadedAt = 0;
    this.events = new AbortController();
    const listen = (element, event, handler) => element.addEventListener(event, handler, {signal: this.events.signal});
    listen($('currency-toggle'), 'click', () => {
      this.expanded = !this.expanded;
      this.renderItems();
      if (!this.expanded) $('currency-toggle').scrollIntoView({block: 'nearest'});
    });
    listen($('currency-retry'), 'click', () => this.loadRates());
    listen(document, 'visibilitychange', () => { if (!document.hidden) this.ensureRates(); });
    listen(window, 'focus', () => this.ensureRates());
    listen(window, 'pagehide', () => { this.reset(); this.events.abort(); });
  }

  reset() {
    this.request?.abort();
    this.request = null;
    this.totals = this.values = [];
    this.expanded = false;
    $('foreign-currencies').hidden = true;
    $('foreign-currencies').removeAttribute('aria-busy');
    $('currency-grid').replaceChildren();
    $('currency-status').hidden = $('currency-retry').hidden = true;
  }

  update(entries) {
    const totals = sumForeignAmounts(entries);
    if (JSON.stringify(totals) !== JSON.stringify(this.totals)) this.expanded = false;
    this.totals = totals;
    if (!totals.length) { this.reset(); return; }
    $('foreign-currencies').hidden = false;
    this.ensureRates();
  }

  ensureRates() {
    if (!this.totals.length || document.hidden) return;
    if (this.cached?.requestedDate === today() && Date.now() - this.loadedAt < HOUR) {
      this.applyRates(this.cached);
    } else if (!this.request) {
      void this.loadRates();
    } else this.renderItems();
  }

  applyRates(snapshot) {
    const {values, dates} = valueForeignAmounts(this.totals, snapshot, today());
    this.values = values;
    const latest = dates.at(-1), first = dates[0];
    $('currency-quote-date').textContent = dates.length > 1
      ? `Курсы от ${dateLabel(first)} — ${dateLabel(latest)}`
      : latest === today() ? `По курсу на сегодня · ${dateLabel(latest)}` : `Курс от ${dateLabel(latest)}`;
    const incomplete = values.some(value => value.czkMinor === null);
    $('currency-status').textContent = incomplete ? 'Для некоторых валют курс недоступен.' : '';
    $('currency-status').hidden = $('currency-retry').hidden = !incomplete;
    $('currency-status').classList.toggle('error', incomplete);
    this.renderItems();
  }

  async loadRates() {
    if (!this.totals.length) return;
    this.request?.abort();
    const request = new AbortController(), date = today();
    this.request = request;
    this.values = [];
    $('foreign-currencies').setAttribute('aria-busy', 'true');
    $('currency-quote-date').textContent = 'Обновляем курс…';
    $('currency-status').hidden = $('currency-retry').hidden = true;
    this.renderItems();
    try {
      const snapshot = await this.read(date, request.signal);
      if (this.request !== request || request.signal.aborted) return;
      if (date !== today()) { this.request = null; void this.loadRates(); return; }
      this.applyRates(snapshot);
      this.cached = snapshot;
      this.loadedAt = Date.now();
    } catch (error) {
      if (this.request !== request || request.signal.aborted) return;
      this.values = this.totals.map(total => ({...total, czkMinor: null, date: null}));
      $('currency-quote-date').textContent = 'Курс недоступен';
      $('currency-status').textContent = 'Не удалось получить текущий курс. Попробуй ещё раз.';
      $('currency-status').classList.add('error');
      $('currency-status').hidden = $('currency-retry').hidden = false;
      this.renderItems();
    } finally {
      if (this.request === request) {
        this.request = null;
        $('foreign-currencies').removeAttribute('aria-busy');
      }
    }
  }

  renderItems() {
    const quotes = new Map(this.values.map(value => [value.currency, value]));
    const items = (this.expanded ? this.totals : this.totals.slice(0, 3)).map(total => {
      const item = node('li', undefined, 'foreign-currency');
      item.dataset.currency = total.currency;
      const heading = node('div', undefined, 'foreign-currency-heading');
      const name = friendlyNames[total.currency] || names.of(total.currency) || total.currency;
      heading.append(node('span', total.currency, 'currency-code'), node('span', name[0].toLocaleUpperCase('ru-RU') + name.slice(1)));
      const amounts = node('div', undefined, 'foreign-currency-values');
      const quote = quotes.get(total.currency);
      const equivalent = node('span', !quote ? '…' : quote.czkMinor === null ? 'Нет курса'
        : `(≈ ${czk.format(quote.czkMinor / 100)} Kč)`, 'currency-equivalent');
      if (quote?.date) equivalent.title = `Курс от ${dateLabel(quote.date)}`;
      amounts.append(node('span', originalAmount(total), 'currency-original'), equivalent);
      item.append(heading, amounts);
      return item;
    });
    $('currency-grid').replaceChildren(...items);
    $('currency-grid').dataset.count = String(items.length);
    const button = $('currency-toggle');
    button.hidden = this.totals.length <= 3;
    button.setAttribute('aria-expanded', String(this.expanded));
    button.textContent = this.expanded ? 'Свернуть' : `Показать ещё ${this.totals.length - 3}`;
    const chevron = node('span', this.expanded ? '⌃' : '⌄', 'currency-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    button.append(chevron);
  }
}
