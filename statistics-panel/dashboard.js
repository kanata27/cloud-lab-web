"use strict";
const AUTH_TOKEN_KEY = "kanata_admin_token";
const API_BASE = window.KANATA_CONFIG.apiBase;
const DAY = 86400000;
const MAX_DAYS = 90;

function todayInZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(day, offset) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
}

function validateRange(from, to, today) {
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T00:00:00Z"))
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  if (!validDate(from) || !validDate(to)) throw new Error("Выбери начальную и конечную дату.");
  if (from > to) throw new Error("Начало периода должно быть раньше его окончания.");
  if (to > today) throw new Error("Конец периода не может быть позже сегодняшнего дня.");
  const days = (Date.parse(to) - Date.parse(from)) / DAY + 1;
  if (days > MAX_DAYS) throw new Error(`Выбери период не длиннее ${MAX_DAYS} дней.`);
  return days;
}

function assertReport(data, selection, timeZone) {
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const totals = data?.totals;
  const expectedDays = (Date.parse(selection.to) - Date.parse(selection.from)) / DAY + 1;
  if (data?.version !== 1 || data?.range?.from !== selection.from
      || data?.range?.to !== selection.to || data?.range?.source !== selection.source
      || data?.range?.time_zone !== timeZone || !totals
      || !Number.isFinite(Date.parse(data.generated_at))
      || !Array.isArray(data.daily) || data.daily.length !== expectedDays) {
    throw new Error("API вернул отчёт в неожиданном формате.");
  }
  const fields = ["page_views", "sessions", "outbound_clicks", "converted_sessions", "youtube", "instagram"];
  if (!fields.every(key => count(totals[key]))
      || totals.converted_sessions > totals.sessions
      || totals.outbound_clicks !== totals.youtube + totals.instagram
      || !data.sources || !["qr", "direct"].every(key => count(data.sources[key]))) {
    throw new Error("В отчёте обнаружены некорректные показатели.");
  }
  for (const [index, day] of data.daily.entries()) {
    if (day.date !== addDays(selection.from, index)
        || !["page_views", "sessions", "outbound_clicks", "youtube", "instagram"].every(key => count(day[key]))
        || day.outbound_clicks !== day.youtube + day.instagram) {
      throw new Error("В ежедневной статистике обнаружена ошибка.");
    }
  }
  for (const key of ["page_views", "outbound_clicks", "youtube", "instagram"]) {
    if (data.daily.reduce((sum, day) => sum + day[key], 0) !== totals[key]) {
      throw new Error("Суммы за период и по дням не совпадают.");
    }
  }
  if (data.sources.qr + data.sources.direct !== totals.page_views) {
    throw new Error("Распределение источников не совпадает с числом просмотров.");
  }
  if (!data.destinations || !["instagram_only", "youtube_only", "both"].every(key => count(data.destinations[key]))
      || Object.values(data.destinations).reduce((sum, value) => sum + value, 0) !== totals.converted_sessions) {
    throw new Error("В распределении переходов обнаружена ошибка.");
  }
  return data;
}


const integer = new Intl.NumberFormat("ru-RU");
const percent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 });
const shortDate = value => new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "short", timeZone: "UTC",
}).format(new Date(value + "T12:00:00Z"));
const byId = id => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
function svgNode(name, attrs, content) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (content !== undefined) node.textContent = content;
  return node;
}


const fullDate = value => new Intl.DateTimeFormat("ru-RU", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(value + "T12:00:00Z"));
const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

class DateCalendar {
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

class Dashboard {
  constructor({ timeZone, fetchReport, onSessionEnd }) {
    this.timeZone = timeZone;
    this.fetchReport = fetchReport;
    this.onSessionEnd = onSessionEnd;
    this.controller = null;
    this.data = null;
    this.mode = "period";
    this.singleDate = todayInZone(timeZone);
    this.savedRange = { from: addDays(this.singleDate, -29), to: this.singleDate };
    this.calendar = new DateCalendar(timeZone, date => {
      this.singleDate = date; this.setMode("day"); this.syncPresets(); this.load();
    });
    byId("open-calendar").addEventListener("click", () => this.calendar.open(this.singleDate));
    for (const button of document.querySelectorAll("[data-mode]")) button.addEventListener("click", () => {
      const mode = button.dataset.mode;
      if (mode === "day" && this.mode === "period" && byId("to").value && byId("to").value <= todayInZone(this.timeZone)) this.singleDate = byId("to").value;
      this.setMode(mode); this.syncPresets(); this.load();
      if (mode === "day") this.calendar.open(this.singleDate);
    });
    byId("time-zone").textContent = timeZone;
    byId("filters").addEventListener("submit", event => {
      event.preventDefault(); this.load();
    });
    for (const button of document.querySelectorAll("[data-days]")) {
      button.addEventListener("click", () => { this.setPreset(Number(button.dataset.days)); this.load(); });
    }
    for (const id of ["from", "to"]) byId(id).addEventListener("input", () => {
      for (const button of document.querySelectorAll("[data-days]")) button.setAttribute("aria-pressed", "false");
    });
    byId("source").addEventListener("change", () => this.load());
    this.resizeObserver = new ResizeObserver(() => { if (this.data) this.drawChart(); });
    this.resizeObserver.observe(byId("chart"));
    this.setPreset(30);
  }

  setMode(mode) {
    if (mode === "day") {
      if (this.mode === "period") this.savedRange = { from: byId("from").value, to: byId("to").value };
      byId("from").value = this.singleDate;
      byId("to").value = this.singleDate;
    } else if (this.mode === "day") {
      byId("from").value = this.savedRange.from;
      byId("to").value = this.savedRange.to;
    }
    this.mode = mode;
    byId("range-fields").hidden = mode === "day";
    byId("single-date-field").hidden = mode !== "day";
    for (const id of ["from", "to"]) byId(id).disabled = mode === "day";
    for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    byId("date-value").textContent = fullDate(this.singleDate);
    byId("range-note").textContent = mode === "day" ? "Статистика за один день" : "До 90 дней за запрос";
  }

  syncPresets() {
    const today = todayInZone(this.timeZone);
    for (const button of document.querySelectorAll("[data-days]")) {
      const matches = byId("from").value === addDays(today, 1 - Number(button.dataset.days)) && byId("to").value === today;
      button.setAttribute("aria-pressed", String(matches));
    }
  }

  setPreset(days) {
    const today = todayInZone(this.timeZone);
    this.singleDate = today;
    this.setMode(days === 1 ? "day" : "period");
    byId("from").value = addDays(today, 1 - days);
    byId("to").value = today;
    if (days !== 1) this.savedRange = { from: byId("from").value, to: today };
    this.syncPresets();
  }

  message(text, error = false) {
    const element = byId("message");
    element.textContent = text;
    element.hidden = !text;
    element.dataset.error = String(error);
    element.setAttribute("role", error ? "alert" : "status");
  }

  reset() {
    this.controller?.abort();
    this.controller = null;
    this.data = null;
    byId("report").hidden = true;
    byId("updated").textContent = "";
    byId("dashboard").removeAttribute("aria-busy");
  }

  async load() {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const selection = {
      from: byId("from").value, to: byId("to").value, source: byId("source").value,
    };
    byId("report").hidden = true;
    byId("updated").textContent = "";
    this.data = null;
    try {
      const today = todayInZone(this.timeZone);
      byId("from").max = today;
      byId("to").max = today;
      validateRange(selection.from, selection.to, today);
      byId("dashboard").setAttribute("aria-busy", "true");
      this.message("Загружаем статистику…");
      const response = await this.fetchReport(selection, controller.signal);
      if (this.controller !== controller || controller.signal.aborted) return;
      this.data = assertReport(response, selection, this.timeZone);
      byId("report").hidden = false;
      this.render();
      this.message(this.data.totals.page_views === 0 && this.data.totals.outbound_clicks === 0
        ? "За этот период доставленных событий нет." : "");
    } catch (error) {
      if (controller.signal.aborted || this.controller !== controller) return;
      if (error.code === "SESSION_EXPIRED") { this.reset(); this.onSessionEnd(); return; }
      this.message(error.message || "Не удалось загрузить отчёт. Попробуй ещё раз.", true);
    } finally {
      if (this.controller === controller) byId("dashboard").removeAttribute("aria-busy");
    }
  }

  render() {
    const { totals, sources, daily } = this.data;
    byId("views-value").textContent = integer.format(totals.page_views);
    byId("sessions-value").textContent = integer.format(totals.sessions);
    byId("clicks-value").textContent = integer.format(totals.outbound_clicks);
    byId("conversion-value").textContent = totals.sessions
      ? percent.format(totals.converted_sessions / totals.sessions) : "—";
    byId("updated").textContent = "Обновлено " + new Intl.DateTimeFormat("ru-RU", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: this.timeZone,
    }).format(new Date(this.data.generated_at));
    this.renderBars("platform-bars", [["Только Instagram", this.data.destinations.instagram_only], ["Только YouTube", this.data.destinations.youtube_only], ["YouTube + Instagram", this.data.destinations.both]]);
    this.renderBars("source-bars", [["QR", sources.qr], ["Без QR", sources.direct]]);
    const rows = daily.map(day => {
      const row = document.createElement("tr");
      for (const value of [shortDate(day.date), day.page_views, day.sessions, day.youtube, day.instagram]) {
        const cell = document.createElement("td");
        cell.textContent = typeof value === "number" ? integer.format(value) : value;
        row.append(cell);
      }
      return row;
    });
    byId("daily-body").replaceChildren(...rows);
    this.drawChart();
  }

  renderBars(id, values) {
    const total = values.reduce((sum, [, value]) => sum + value, 0);
    const rows = values.map(([label, value]) => {
      const row = document.createElement("div");
      const heading = document.createElement("div"); heading.className = "bar-heading";
      const name = document.createElement("span"); name.textContent = label;
      const count = document.createElement("b");
      count.textContent = `${integer.format(value)} · ${total ? percent.format(value / total) : "—"}`;
      heading.append(name, count);
      const track = document.createElement("div"); track.className = "bar-track"; track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("div"); fill.className = "bar-fill";
      fill.style.width = `${total ? value / total * 100 : 0}%`;
      track.append(fill); row.append(heading, track); return row;
    });
    byId(id).replaceChildren(...rows);
  }

  drawDayChart(day) {
    const max = Math.max(1, day.page_views, day.outbound_clicks);
    const rows = [["Просмотры", day.page_views, "var(--accent)"], ["Переходы", day.outbound_clicks, "var(--blue)"]].map(([label, value, color]) => {
      const row = document.createElement("div"); row.className = "day-bar-row";
      const heading = document.createElement("div"); heading.className = "day-bar-heading";
      const name = document.createElement("span"); name.textContent = label;
      const number = document.createElement("strong"); number.textContent = integer.format(value);
      heading.append(name, number);
      const track = document.createElement("div"); track.className = "day-bar-track"; track.setAttribute("aria-hidden", "true");
      const fill = document.createElement("div"); fill.className = "day-bar-fill";
      fill.style.width = `${value / max * 100}%`; fill.style.background = color;
      track.append(fill); row.append(heading, track); return row;
    });
    byId("chart").replaceChildren(...rows);
    byId("chart-detail").textContent = `Всего за ${fullDate(day.date)}`;
  }

  drawChart() {
    if (!this.data) return;
    const single = this.data.daily.length === 1;
    byId("traffic-title").textContent = single ? "За день" : "По дням";
    byId("traffic-legend").hidden = single;
    byId("chart").classList.toggle("single-day", single);
    if (single) { this.drawDayChart(this.data.daily[0]); return; }
    const container = byId("chart");
    const width = container.clientWidth;
    if (width < 100 || !this.data) return;
    const height = container.clientHeight;
    const data = this.data.daily;
    const pad = { left: 48, right: 12, top: 16, bottom: 32 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const max = Math.max(1, ...data.flatMap(day => [day.page_views, day.outbound_clicks]));
    const step = Math.max(1, Math.ceil(max / 4));
    const ceiling = step * 4;
    const x = index => pad.left + (data.length === 1 ? plotWidth / 2 : index / (data.length - 1) * plotWidth);
    const y = value => pad.top + plotHeight * (1 - value / ceiling);
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-labelledby": "chart-title chart-desc" });
    svg.append(svgNode("title", { id: "chart-title" }, "Просмотры и переходы по дням"));
    svg.append(svgNode("desc", { id: "chart-desc" }, "По горизонтали — даты, по вертикали — число событий. Все значения доступны в таблице «Числа по дням» ниже."));
    for (let n = 0; n <= 4; n++) {
      const value = n * step;
      svg.append(svgNode("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), class: "grid-line" }));
      svg.append(svgNode("text", { x: pad.left - 10, y: y(value) + 4, "text-anchor": "end" }, integer.format(value)));
    }
    const tickCount = Math.min(data.length, width < 450 ? 3 : 6);
    for (let n = 0; n < tickCount; n++) {
      const index = tickCount === 1 ? 0 : Math.round(n / (tickCount - 1) * (data.length - 1));
      svg.append(svgNode("text", {
        x: x(index), y: height - 6,
        "text-anchor": tickCount === 1 ? "middle" : n === 0 ? "start" : n === tickCount - 1 ? "end" : "middle",
      }, shortDate(data[index].date)));
    }
    for (const [key, className] of [["page_views", "views-path"], ["outbound_clicks", "clicks-path"]]) {
      const path = data.map((day, index) => `${index ? "L" : "M"}${x(index)},${y(day[key])}`).join(" ");
      svg.append(svgNode("path", { d: path, class: `data-path ${className}` }));
      if (data.length === 1) svg.append(svgNode("circle", {
        cx: x(0), cy: y(data[0][key]), r: 4, fill: key === "page_views" ? "var(--accent)" : "var(--blue)",
      }));
    }
    const detail = index => {
      const day = data[index];
      byId("chart-detail").textContent = `${shortDate(day.date)} · ${integer.format(day.page_views)} просмотров · ${integer.format(day.outbound_clicks)} переходов`;
    };
    const hit = svgNode("rect", { x: pad.left, y: pad.top, width: plotWidth, height: plotHeight, fill: "transparent" });
    hit.addEventListener("pointermove", event => {
      const rect = svg.getBoundingClientRect();
      const position = (event.clientX - rect.left - pad.left) / plotWidth;
      detail(Math.max(0, Math.min(data.length - 1, Math.round(position * (data.length - 1)))));
    });
    hit.addEventListener("pointerleave", () => detail(data.length - 1));
    svg.append(hit);
    container.replaceChildren(svg);
    detail(data.length - 1);
  }
}

async function apiReport(selection, signal) {
  const token = sessionStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    const error = new Error("Сессия истекла.");
    error.code = "SESSION_EXPIRED";
    throw error;
  }

  const query = new URLSearchParams(selection);
  const response = await fetch(`${API_BASE}/stats?${query}`, {
    cache: "no-store",
    credentials: "omit",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    const error = new Error("Сессия истекла.");
    error.code = "SESSION_EXPIRED";
    throw error;
  }

  if (!response.ok) {
    throw new Error("Не удалось загрузить статистику.");
  }

  return response.json();
}

document.getElementById("logout").addEventListener("click", () => {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  document.getElementById("dashboard").hidden = true;
});

window.addEventListener("pageshow", event => {
  if (event.persisted && !sessionStorage.getItem(AUTH_TOKEN_KEY)) {
    document.getElementById("dashboard").hidden = true;
    window.location.replace("./login.html");
  }
});

if (!sessionStorage.getItem(AUTH_TOKEN_KEY)) {
  window.location.replace("./login.html");
} else {
  document.getElementById("dashboard").hidden = false;
  const dashboard = new Dashboard({
    timeZone: "UTC",
    fetchReport: apiReport,
    onSessionEnd() {
      sessionStorage.removeItem(AUTH_TOKEN_KEY);
      window.location.replace("./login.html");
    },
  });
  dashboard.load();
}
