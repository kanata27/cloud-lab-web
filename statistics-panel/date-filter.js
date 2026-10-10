const DAY = 86400000;
const byId = id => document.getElementById(id);

export function todayInZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(day, offset) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
}

export const fullDate = value => new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(value + "T12:00:00Z"));
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export class DateCalendar {
  constructor(timeZone, onSelect) {
    this.timeZone = timeZone;
    this.onSelect = onSelect;
    this.dialog = byId("date-calendar");
    this.selected = todayInZone(timeZone);
    this.firstYear = Number(this.selected.slice(0, 4)) - 10;
    monthNames.forEach((name, index) => byId("calendar-month").add(new Option(name, String(index))));
    for (let year = Number(this.selected.slice(0, 4)); year >= this.firstYear; year--) {
      byId("calendar-year").add(new Option(String(year), String(year)));
    }
    byId("calendar-close").addEventListener("click", () => this.dialog.close());
    this.dialog.addEventListener("close", () => { byId("open-calendar").setAttribute("aria-expanded", "false"); byId("open-calendar").focus(); });
    this.dialog.addEventListener("click", event => {
      const rect = this.dialog.getBoundingClientRect();
      if (event.target === this.dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) this.dialog.close();
    });
    byId("calendar-prev").addEventListener("click", () => this.moveMonth(-1));
    byId("calendar-next").addEventListener("click", () => this.moveMonth(1));
    for (const id of ["calendar-month", "calendar-year"]) byId(id).addEventListener("change", () => {
      const today = todayInZone(this.timeZone);
      this.month = Number(byId("calendar-month").value);
      this.year = Number(byId("calendar-year").value);
      if (this.year === Number(today.slice(0, 4))) this.month = Math.min(this.month, Number(today.slice(5, 7)) - 1);
      this.render();
    });
    byId("calendar-today").addEventListener("click", () => this.choose(todayInZone(this.timeZone)));
  }
  open(selected) {
    const today = todayInZone(this.timeZone);
    this.selected = selected && selected <= today ? selected : today;
    this.year = Number(this.selected.slice(0, 4));
    this.month = Number(this.selected.slice(5, 7)) - 1;
    if (this.year < this.firstYear) {
      for (let year = this.firstYear - 1; year >= this.year; year--) byId("calendar-year").add(new Option(String(year), String(year)));
      this.firstYear = this.year;
    }
    this.render();
    byId("open-calendar").setAttribute("aria-expanded", "true");
    this.dialog.showModal();
    this.dialog.querySelector('[aria-pressed="true"]')?.focus();
  }
  moveMonth(delta) {
    const next = new Date(Date.UTC(this.year, this.month + delta, 1));
    this.year = next.getUTCFullYear(); this.month = next.getUTCMonth(); this.render();
  }
  choose(value) {
    this.selected = value;
    this.dialog.close();
    this.onSelect(value);
  }
  render() {
    const today = todayInZone(this.timeZone);
    const todayYear = Number(today.slice(0, 4)), todayMonth = Number(today.slice(5, 7)) - 1;
    byId("calendar-month").value = String(this.month);
    byId("calendar-year").value = String(this.year);
    for (const option of byId("calendar-month").options) option.disabled = this.year === todayYear && Number(option.value) > todayMonth;
    byId("calendar-prev").disabled = this.year === this.firstYear && this.month === 0;
    byId("calendar-next").disabled = this.year === todayYear && this.month === todayMonth;
    byId("calendar-selection").textContent = fullDate(this.selected);
    const days = byId("calendar-days");
    days.setAttribute("aria-label", `${monthNames[this.month]} ${this.year}`);
    const nodes = [];
    const prefix = `${this.year}-${String(this.month + 1).padStart(2, "0")}-`;
    const leading = (new Date(Date.UTC(this.year, this.month, 1)).getUTCDay() + 6) % 7;
    for (let n = 0; n < leading; n++) {
      const blank = document.createElement("span"); blank.setAttribute("aria-hidden", "true"); nodes.push(blank);
    }
    const count = new Date(Date.UTC(this.year, this.month + 1, 0)).getUTCDate();
    for (let n = 1; n <= count; n++) {
      const value = prefix + String(n).padStart(2, "0");
      const button = document.createElement("button");
      button.type = "button"; button.className = "calendar-day"; button.textContent = String(n);
      button.dataset.date = value;
      button.disabled = value > today;
      button.setAttribute("aria-label", fullDate(value));
      button.setAttribute("aria-pressed", String(value === this.selected));
      if (value === today) button.setAttribute("aria-current", "date");
      button.addEventListener("click", () => this.choose(value));
      button.addEventListener("keydown", event => {
        const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (!offset) return;
        event.preventDefault();
        const target = addDays(value, offset);
        if (target > today || Number(target.slice(0, 4)) < this.firstYear) return;
        this.year = Number(target.slice(0, 4)); this.month = Number(target.slice(5, 7)) - 1;
        this.render();
        days.querySelector(`[data-date="${target}"]`)?.focus();
      });
      nodes.push(button);
    }
    days.replaceChildren(...nodes);
  }
}

export function validateDateRange(from, to, today, maxDays = 367) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to)) throw new Error('Выбери начальную и конечную дату.');
  if (from > to) throw new Error('Начало периода должно быть раньше его окончания.');
  if (to > today) throw new Error('Конец периода не может быть позже сегодняшнего дня.');
  const days = (Date.parse(to) - Date.parse(from)) / DAY + 1;
  if (days > maxDays) throw new Error('Выбери период не длиннее года.');
  return days;
}

export function presetRange(today, { days, months }) {
  if (months) {
    const date = new Date(today + 'T00:00:00Z');
    const anchor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
    const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
    anchor.setUTCDate(Math.min(date.getUTCDate(), lastDay));
    return { from: addDays(anchor.toISOString().slice(0, 10), 1), to: today };
  }
  return { from: addDays(today, 1 - days), to: today };
}

// Both pages use the same calendar and the same date/period behaviour.
export class DateFilters {
  constructor({ timeZone, onChange, maxDays = 367 }) {
    this.timeZone = timeZone;
    this.onChange = onChange;
    this.maxDays = maxDays;
    this.form = byId('filters');
    this.mode = 'period';
    this.singleDate = todayInZone(timeZone);
    this.savedRange = presetRange(this.singleDate, { days: 30 });
    this.presets = [...this.form.querySelectorAll('[data-days], [data-months]')];
    this.modeButtons = [...this.form.querySelectorAll('[data-mode]')];
    if (byId('date-calendar')) {
      this.calendar = new DateCalendar(timeZone, value => {
        this.singleDate = value;
        this.setMode('day');
        this.syncPresets();
        this.onChange();
      });
      byId('open-calendar').addEventListener('click', () => this.calendar.open(this.singleDate));
    }
    this.form.addEventListener('submit', event => { event.preventDefault(); this.onChange(); });
    this.modeButtons.forEach(button => button.addEventListener('click', () => {
      if (button.dataset.mode === 'day' && this.mode === 'period' && byId('to').value
          && byId('to').value <= todayInZone(this.timeZone)) this.singleDate = byId('to').value;
      this.setMode(button.dataset.mode);
      this.syncPresets();
      this.onChange();
      if (this.mode === 'day') this.calendar.open(this.singleDate);
    }));
    this.presets.forEach(button => button.addEventListener('click', () => {
      this.setPreset({ days: Number(button.dataset.days), months: Number(button.dataset.months) });
      this.onChange();
    }));
    for (const id of ['from', 'to']) byId(id).addEventListener('input', () => this.syncPresets());
    this.setPreset({ days: 30 });
  }

  setMode(mode) {
    if (!this.calendar) return;
    if (mode === 'day') {
      if (this.mode === 'period') this.savedRange = { from: byId('from').value, to: byId('to').value };
      byId('from').value = byId('to').value = this.singleDate;
    } else if (this.mode === 'day') {
      byId('from').value = this.savedRange.from;
      byId('to').value = this.savedRange.to;
    }
    this.mode = mode;
    byId('range-fields').hidden = mode === 'day';
    byId('single-date-field').hidden = mode !== 'day';
    for (const id of ['from', 'to']) byId(id).disabled = mode === 'day';
    this.modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    byId('date-value').textContent = fullDate(this.singleDate);
    byId('range-note').textContent = mode === 'day' ? 'Статистика за один день' : 'До года за запрос';
  }

  setPreset(preset) {
    const today = todayInZone(this.timeZone);
    this.singleDate = today;
    this.setMode(preset.days === 1 ? 'day' : 'period');
    const range = presetRange(today, preset);
    byId('from').value = range.from;
    byId('to').value = range.to;
    if (this.mode === 'period') this.savedRange = range;
    this.syncPresets();
  }

  setRange(from, to) {
    this.savedRange = { from, to };
    this.setMode('period');
    byId('from').value = from;
    byId('to').value = to;
    this.syncPresets();
  }

  syncPresets() {
    const today = todayInZone(this.timeZone);
    this.presets.forEach(button => {
      const range = presetRange(today, { days: Number(button.dataset.days), months: Number(button.dataset.months) });
      button.setAttribute('aria-pressed', String(byId('from').value === range.from && byId('to').value === range.to));
    });
  }

  selection() {
    const today = todayInZone(this.timeZone);
    byId('from').max = byId('to').max = today;
    const range = { from: byId('from').value, to: byId('to').value };
    validateDateRange(range.from, range.to, today, this.maxDays);
    return range;
  }
}

