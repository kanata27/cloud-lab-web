import {today} from './earnings-model.js';
import {buildEarningsCalendar} from './earnings-calendar-model.js';

const $ = id => document.getElementById(id);
const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const amount = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});
const money = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 2});
const dateFormat = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'UTC'});
const fullDate = date => dateFormat.format(new Date(date + 'T12:00:00Z'));
const time = minutes => `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} мин` : ''}`;
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export class EarningsCalendar {
  constructor({read}) {
    this.read = read;
    this.asOf = today();
    this.events = new AbortController();
    this.request = null;
    this.model = null;
    this.anchor = null;
    this.keyboardNavigation = false;
    this.pointerPosition = null;
    const listen = (element, event, handler, options = {}) => element.addEventListener(event, handler, {...options, signal: this.events.signal});
    const year = Number(this.asOf.slice(0, 4));
    $('annual-year').replaceChildren(...Array.from({length: year - 2023}, (_, index) => new Option(String(year - index), String(year - index))));
    listen($('annual-year'), 'change', () => this.load());
    listen($('annual-retry'), 'click', () => this.load());
    listen($('annual-days'), 'pointerover', event => {
      if (event.pointerType === 'touch' || this.keyboardNavigation) return;
      const button = event.target.closest('.annual-day');
      if (button && !button.disabled) this.showDay(button);
    });
    listen($('annual-days'), 'pointerleave', () => {
      const focused = document.activeElement;
      if (focused?.matches('.annual-day')) this.showDay(focused);
      else this.hideTooltip();
    });
    listen($('annual-days'), 'focusin', event => {
      if (event.target.matches('.annual-day')) {
        this.keyboardNavigation = true;
        this.activate(event.target); this.showDay(event.target);
      }
    });
    listen($('annual-days'), 'focusout', event => {
      if (!$('annual-days').contains(event.relatedTarget)) this.hideTooltip();
    });
    listen($('annual-days'), 'click', event => {
      const button = event.target.closest('.annual-day');
      if (button && !button.disabled) {
        this.keyboardNavigation = false;
        this.activate(button); this.showDay(button);
      }
    });
    listen($('annual-days'), 'keydown', event => this.navigate(event));
    listen(document, 'pointermove', event => {
      if (event.pointerType === 'touch') return;
      const previous = this.pointerPosition;
      this.pointerPosition = {x: event.clientX, y: event.clientY};
      if (previous && previous.x === event.clientX && previous.y === event.clientY) return;
      if (!this.keyboardNavigation) return;
      this.keyboardNavigation = false;
      const button = event.target.closest('.annual-day');
      if (button && $('annual-days').contains(button) && !button.disabled) this.showDay(button);
    }, {passive: true});
    listen(document, 'pointerdown', event => {
      this.keyboardNavigation = false;
      this.pointerPosition = {x: event.clientX, y: event.clientY};
      if (!event.target.closest('.annual-day')) this.hideTooltip();
    });
    listen(window, 'resize', () => this.positionTooltip());
    listen(window, 'pagehide', () => this.destroy());
    listen(document, 'scroll', () => this.positionTooltip(), {capture: true, passive: true});
    void this.load();
  }

  async load() {
    this.request?.abort();
    const request = new AbortController(), year = Number($('annual-year').value);
    this.request = request;
    this.model = null;
    this.hideTooltip();
    $('annual-panel').setAttribute('aria-busy', 'true');
    $('annual-report').hidden = true;
    $('annual-days').replaceChildren();
    $('annual-retry').hidden = true;
    $('annual-message').hidden = false;
    $('annual-message').classList.remove('error');
    $('annual-message').setAttribute('role', 'status');
    $('annual-message').textContent = 'Загружаем календарь…';
    try {
      const data = await this.read(year, request.signal);
      if (request !== this.request || request.signal.aborted) return;
      this.model = buildEarningsCalendar(data, year, this.asOf);
      this.render();
      $('annual-message').hidden = true;
      $('annual-report').hidden = false;
    } catch (error) {
      if (request !== this.request || request.signal.aborted) return;
      $('annual-message').textContent = error.message;
      $('annual-message').classList.add('error');
      $('annual-message').setAttribute('role', 'alert');
      $('annual-retry').hidden = false;
    } finally {
      if (request === this.request) $('annual-panel').removeAttribute('aria-busy');
    }
  }

  render() {
    const model = this.model;
    $('annual-calendar').style.setProperty('--annual-weeks', String(model.weeks));
    $('annual-days').setAttribute('aria-label', `Заработок за час, ${model.year} год`);
    $('annual-months').replaceChildren(...model.months.map(month => {
      const label = node('span', months[month.month]);
      label.style.gridColumn = String(month.column);
      return label;
    }));
    const focusDate = model.days.filter(day => !day.future).at(-1)?.date;
    const cells = model.cells.map(day => {
      if (!day) return node('span', undefined, 'annual-placeholder');
      const button = node('button', undefined, 'annual-day');
      button.type = 'button';
      button.dataset.date = day.date;
      button.dataset.level = String(day.level);
      button.dataset.hour = day.hourCzk === null ? '' : String(day.hourCzk);
      button.disabled = day.future;
      button.tabIndex = day.date === focusDate ? 0 : -1;
      if (day.future) {
        button.dataset.future = 'true';
        button.title = `${fullDate(day.date)}: день ещё не наступил`;
      }
      if (day.date === this.asOf) button.setAttribute('aria-current', 'date');
      const detail = day.future ? 'день ещё не наступил' : day.count
        ? `${amount.format(day.hourCzk)} Kč/ч (${amount.format(day.hourEur)} €/ч), всего: ${money.format(day.czkMinor / 100)} Kč (${money.format(day.eurMinor / 100)} €), ${day.spots.join(' · ')}, время: ${time(day.minutes)}`
        : 'выступлений не было';
      button.setAttribute('aria-label', `${fullDate(day.date)}: ${detail}`);
      return button;
    });
    $('annual-days').replaceChildren(...cells);
    $('annual-scroll').scrollLeft = 0;
    $('annual-summary').textContent = `Дней с выступлениями: ${model.activeDays}`;
  }

  activate(button) {
    $('annual-days').querySelector('[tabindex="0"]')?.setAttribute('tabindex', '-1');
    button.tabIndex = 0;
  }

  navigate(event) {
    if (!this.model || !event.target.matches('.annual-day')) return;
    if (event.key === 'Escape') { this.keyboardNavigation = true; event.preventDefault(); this.hideTooltip(); return; }
    const index = this.model.days.findIndex(day => day.date === event.target.dataset.date);
    const last = this.model.days.findLastIndex(day => !day.future);
    const next = {ArrowUp: index - 1, ArrowDown: index + 1, ArrowLeft: index - 7, ArrowRight: index + 7, Home: 0, End: last}[event.key];
    if (next === undefined) return;
    event.preventDefault();
    // Scrolling can fire pointerover under a stationary mouse; keep the keyboard's selected day.
    this.keyboardNavigation = true;
    const date = this.model.days[Math.max(0, Math.min(last, next))].date;
    const button = $('annual-days').querySelector(`[data-date="${date}"]`);
    this.activate(button);
    button.focus({preventScroll: true});
    button.scrollIntoView({block: 'nearest', inline: 'nearest'});
    this.showDay(button);
  }

  showDay(button) {
    if (!this.model || $('annual-report').hidden) return;
    const day = this.model.days.find(row => row.date === button.dataset.date);
    if (!day || day.future) return;
    this.hideTooltip();
    this.anchor = button;
    const tooltip = $('annual-tooltip');
    tooltip.replaceChildren(node('strong', fullDate(day.date)));
    if (day.count) {
      const list = node('dl');
      for (const [name, value] of [
        ['За час', `${amount.format(day.hourCzk)} Kč (${amount.format(day.hourEur)} €)`],
        ['Всего', `${money.format(day.czkMinor / 100)} Kč (${money.format(day.eurMinor / 100)} €)`],
        ['Время', time(day.minutes)],
        [day.spots.length > 1 ? 'Точки' : 'Точка', day.spots.join(' · ')],
      ]) {
        list.append(node('dt', name), node('dd', value));
      }
      tooltip.append(list);
    } else tooltip.append(node('p', 'Выступлений не было.'));
    button.setAttribute('aria-describedby', tooltip.id);
    tooltip.showPopover();
    this.positionTooltip();
  }

  hideTooltip() {
    this.anchor?.removeAttribute('aria-describedby');
    this.anchor = null;
    if ($('annual-tooltip').matches(':popover-open')) $('annual-tooltip').hidePopover();
  }

  positionTooltip() {
    if (!this.anchor) return;
    const anchor = this.anchor.getBoundingClientRect(), scroll = $('annual-scroll').getBoundingClientRect();
    if (anchor.right <= Math.max(0, scroll.left) || anchor.left >= Math.min(innerWidth, scroll.right) || anchor.bottom <= 0 || anchor.top >= innerHeight) {
      this.hideTooltip(); return;
    }
    const tooltip = $('annual-tooltip'), box = tooltip.getBoundingClientRect(), edge = 8;
    tooltip.style.left = Math.max(edge, Math.min(anchor.left + anchor.width / 2 - box.width / 2, innerWidth - box.width - edge)) + 'px';
    const above = anchor.top - box.height - 10;
    tooltip.style.top = Math.max(edge, Math.min(above >= edge ? above : anchor.bottom + 10, innerHeight - box.height - edge)) + 'px';
  }

  destroy() {
    this.request?.abort();
    this.events.abort();
    this.hideTooltip();
    this.model = null;
    $('annual-days').replaceChildren();
    $('annual-panel').hidden = true;
  }
}
