const state = {
  schedule: null,
  events: [],
  displayMonth: startOfMonth(new Date()),
  category: "All",
  search: "",
};

const categoryColors = {
  Work: "#62e6bd",
  Meeting: "#6da9ff",
  Personal: "#a48cff",
  Deadline: "#ff7f91",
  Travel: "#ffbf69",
  Training: "#54d6e8",
  Reminder: "#f08fff",
  General: "#9aa8bc",
};

const elements = {
  brandTitle: document.querySelector("#brandTitle"),
  syncStatus: document.querySelector("#syncStatus"),
  todayLabel: document.querySelector("#todayLabel"),
  heroMonth: document.querySelector("#heroMonth"),
  heroDay: document.querySelector("#heroDay"),
  heroWeekday: document.querySelector("#heroWeekday"),
  nextEventTitle: document.querySelector("#nextEventTitle"),
  nextEventTime: document.querySelector("#nextEventTime"),
  weekEventCount: document.querySelector("#weekEventCount"),
  weekScheduledHours: document.querySelector("#weekScheduledHours"),
  timezoneDisplay: document.querySelector("#timezoneDisplay"),
  lastUpdated: document.querySelector("#lastUpdated"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  calendarGrid: document.querySelector("#calendarGrid"),
  categoryFilters: document.querySelector("#categoryFilters"),
  agendaList: document.querySelector("#agendaList"),
  agendaEmpty: document.querySelector("#agendaEmpty"),
  upcomingCount: document.querySelector("#upcomingCount"),
  searchInput: document.querySelector("#searchInput"),
  eventDialog: document.querySelector("#eventDialog"),
  dialogAccent: document.querySelector("#dialogAccent"),
  dialogCategory: document.querySelector("#dialogCategory"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogDate: document.querySelector("#dialogDate"),
  dialogLocationRow: document.querySelector("#dialogLocationRow"),
  dialogLocation: document.querySelector("#dialogLocation"),
  dialogDescriptionRow: document.querySelector("#dialogDescriptionRow"),
  dialogDescription: document.querySelector("#dialogDescription"),
  googleCalendarLink: document.querySelector("#googleCalendarLink"),
  outlookCalendarLink: document.querySelector("#outlookCalendarLink"),
  downloadEventButton: document.querySelector("#downloadEventButton"),
  subscribeDialog: document.querySelector("#subscribeDialog"),
  feedUrlInput: document.querySelector("#feedUrlInput"),
  toast: document.querySelector("#toast"),
};

document.querySelector("#previousMonth").addEventListener("click", () => changeMonth(-1));
document.querySelector("#nextMonth").addEventListener("click", () => changeMonth(1));
document.querySelector("#todayButton").addEventListener("click", () => {
  state.displayMonth = startOfMonth(new Date());
  renderCalendar();
});
elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value.trim().toLowerCase();
  renderCalendar();
  renderAgenda();
});
document.querySelector("#closeDialog").addEventListener("click", () => elements.eventDialog.close());
document.querySelector("#subscribeButton").addEventListener("click", () => elements.subscribeDialog.showModal());
document.querySelector("#closeSubscribeDialog").addEventListener("click", () => elements.subscribeDialog.close());
document.querySelector("#copyFeedButton").addEventListener("click", copyFeedUrl);

for (const dialog of [elements.eventDialog, elements.subscribeDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

loadSchedule();

async function loadSchedule() {
  try {
    const firebase = await import("./firebase-client.js");
    const schedule = await firebase.readSchedule();
    applySchedule(schedule, " Live schedule connected");

    firebase.watchSchedule(
      (nextSchedule) => {
        try {
          applySchedule(nextSchedule, " Live schedule connected");
        } catch (error) {
          console.error("Firebase returned an invalid schedule.", error);
        }
      },
      (error) => console.warn("Firebase schedule listener stopped.", error),
    );
  } catch (firebaseError) {
    console.warn("Firebase schedule unavailable; loading the published backup.", firebaseError);
    await loadBackupSchedule();
  }
}

async function loadBackupSchedule() {
  try {
    const response = await fetch(`data/schedule.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Schedule returned ${response.status}`);
    applySchedule(await response.json(), " Schedule loaded from backup");
  } catch (error) {
    console.error(error);
    elements.syncStatus.lastChild.textContent = " Unable to load schedule";
    elements.calendarGrid.innerHTML = '<p class="load-error">The schedule could not be loaded from Firebase or data/schedule.json.</p>';
  }
}

function applySchedule(schedule, statusText) {
  if (!schedule || !Array.isArray(schedule.events)) {
    throw new Error("Schedule data must contain an events array.");
  }

  state.schedule = schedule;
  state.events = [...schedule.events]
    .map(normalizeEvent)
    .sort((a, b) => a.startDate - b.startDate);

  applyMetadata();
  renderFilters();
  renderCalendar();
  renderAgenda();
  renderStats();

  elements.syncStatus.classList.add("sync-status--ready");
  elements.syncStatus.lastChild.textContent = statusText;
}

function normalizeEvent(event) {
  const allDay = Boolean(event.allDay);
  const startDate = allDay ? parseLocalDate(event.start) : new Date(event.start);
  const endDate = allDay ? parseLocalDate(event.end || event.start) : new Date(event.end);

  return {
    ...event,
    allDay,
    category: event.category || "General",
    status: event.status || "confirmed",
    priority: event.priority || "normal",
    startDate,
    endDate,
  };
}

function applyMetadata() {
  const { meta = {} } = state.schedule;
  const now = new Date();
  const title = meta.title || "Smart Schedule";
  const timezone = meta.timezone || "Asia/Kuala_Lumpur";
  const feedUrl = meta.calendarFeedUrl || new URL("schedule.ics", window.location.href).href;

  document.title = title;
  elements.brandTitle.textContent = title;
  elements.timezoneDisplay.textContent = timezone.replace("_", " ");
  elements.feedUrlInput.value = feedUrl;
  elements.todayLabel.textContent = new Intl.DateTimeFormat("en-MY", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now).toUpperCase();
  elements.heroMonth.textContent = new Intl.DateTimeFormat("en-MY", { month: "short" }).format(now).toUpperCase();
  elements.heroDay.textContent = String(now.getDate()).padStart(2, "0");
  elements.heroWeekday.textContent = new Intl.DateTimeFormat("en-MY", { weekday: "long" }).format(now);

  const updated = meta.lastUpdated ? new Date(meta.lastUpdated) : null;
  elements.lastUpdated.textContent = updated && !Number.isNaN(updated.valueOf())
    ? `Updated ${relativeTime(updated, now)}`
    : "Update time unavailable";
}

function renderFilters() {
  const categories = ["All", ...new Set(state.events.map((event) => event.category))];
  elements.categoryFilters.replaceChildren(
    ...categories.map((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `filter-chip${state.category === category ? " filter-chip--active" : ""}`;
      button.textContent = category;
      button.addEventListener("click", () => {
        state.category = category;
        renderFilters();
        renderCalendar();
        renderAgenda();
      });
      return button;
    }),
  );
}

function renderCalendar() {
  const month = state.displayMonth;
  const firstGridDate = startOfWeek(month);
  const cells = [];
  elements.calendarMonthLabel.textContent = new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
  }).format(month);

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(firstGridDate, index);
    const cell = document.createElement("div");
    const outside = date.getMonth() !== month.getMonth();
    const today = sameDay(date, new Date());
    cell.className = [
      "calendar-day",
      outside ? "calendar-day--outside" : "",
      today ? "calendar-day--today" : "",
    ].filter(Boolean).join(" ");
    cell.dataset.date = dateKey(date);

    const number = document.createElement("span");
    number.className = "calendar-day__number";
    number.textContent = date.getDate();
    cell.append(number);

    const dayEvents = getFilteredEvents().filter((event) => eventOccursOn(event, date));
    for (const event of dayEvents.slice(0, 3)) {
      const eventButton = document.createElement("button");
      eventButton.type = "button";
      eventButton.className = `calendar-event${event.status === "cancelled" ? " calendar-event--cancelled" : ""}`;
      eventButton.style.setProperty("--event-color", getEventColor(event));
      eventButton.textContent = `${event.allDay ? "" : formatTime(event.startDate) + " "}${event.title}`;
      eventButton.title = event.title;
      eventButton.addEventListener("click", () => openEvent(event));
      cell.append(eventButton);
    }

    if (dayEvents.length > 3) {
      const more = document.createElement("span");
      more.className = "calendar-day__more";
      more.textContent = `+${dayEvents.length - 3} more`;
      cell.append(more);
    }

    cells.push(cell);
  }

  elements.calendarGrid.replaceChildren(...cells);
}

function renderAgenda() {
  const today = startOfDay(new Date());
  const upcoming = getFilteredEvents()
    .filter((event) => event.endDate >= today && event.status !== "completed")
    .slice(0, 20);

  elements.upcomingCount.textContent = upcoming.length > 99 ? "99+" : String(upcoming.length);
  elements.agendaEmpty.hidden = upcoming.length > 0;
  elements.agendaList.hidden = upcoming.length === 0;

  const nodes = [];
  let lastDate = "";
  for (const event of upcoming) {
    const key = dateKey(event.startDate);
    if (key !== lastDate) {
      const dateHeading = document.createElement("div");
      dateHeading.className = "agenda-date";
      dateHeading.textContent = formatAgendaDate(event.startDate);
      nodes.push(dateHeading);
      lastDate = key;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = `agenda-item${event.status === "cancelled" ? " agenda-item--cancelled" : ""}`;
    button.style.setProperty("--event-color", getEventColor(event));
    button.innerHTML = `
      <span class="agenda-item__time">${event.allDay ? "ALL\nDAY" : formatTime(event.startDate)}</span>
      <span class="agenda-item__body">
        <strong>${escapeHtml(event.title)}</strong>
        <small>${escapeHtml(event.location || event.category)}</small>
      </span>
      <span class="agenda-item__dot" aria-hidden="true"></span>
    `;
    button.addEventListener("click", () => openEvent(event));
    nodes.push(button);
  }

  elements.agendaList.replaceChildren(...nodes);
}

function renderStats() {
  const now = new Date();
  const next = state.events.find((event) => event.endDate >= now && !["cancelled", "completed"].includes(event.status));
  const weekStart = startOfWeek(now);
  const weekEnd = addDays(weekStart, 7);
  const thisWeek = state.events.filter((event) =>
    event.startDate < weekEnd && event.endDate >= weekStart && event.status !== "cancelled",
  );
  const minutes = thisWeek.reduce((sum, event) => {
    if (event.allDay) return sum;
    return sum + Math.max(0, (event.endDate - event.startDate) / 60000);
  }, 0);

  if (next) {
    elements.nextEventTitle.textContent = next.title;
    elements.nextEventTime.textContent = `${formatAgendaDate(next.startDate)} · ${next.allDay ? "All day" : formatTime(next.startDate)}`;
  }
  elements.weekEventCount.textContent = thisWeek.length;
  elements.weekScheduledHours.textContent = formatHours(minutes);
}

function openEvent(event) {
  const color = getEventColor(event);
  elements.dialogAccent.style.background = color;
  elements.dialogCategory.textContent = `${event.category} · ${event.status}`;
  elements.dialogTitle.textContent = event.title;
  elements.dialogDate.textContent = formatEventDate(event);
  elements.dialogLocationRow.hidden = !event.location;
  elements.dialogLocation.textContent = event.location || "";
  elements.dialogDescriptionRow.hidden = !event.description;
  elements.dialogDescription.textContent = event.description || "";
  elements.googleCalendarLink.href = googleCalendarUrl(event);
  elements.outlookCalendarLink.href = outlookCalendarUrl(event);
  elements.downloadEventButton.onclick = () => downloadEventIcs(event);
  elements.eventDialog.showModal();
}

function getFilteredEvents() {
  return state.events.filter((event) => {
    const categoryMatches = state.category === "All" || event.category === state.category;
    const haystack = `${event.title} ${event.description || ""} ${event.location || ""} ${event.category}`.toLowerCase();
    return categoryMatches && (!state.search || haystack.includes(state.search));
  });
}

function changeMonth(direction) {
  state.displayMonth = new Date(state.displayMonth.getFullYear(), state.displayMonth.getMonth() + direction, 1);
  renderCalendar();
}

function getEventColor(event) {
  return event.color || categoryColors[event.category] || categoryColors.General;
}

function eventOccursOn(event, date) {
  const dayStart = startOfDay(date);
  const dayEnd = addDays(dayStart, 1);
  if (event.allDay) {
    const inclusiveEnd = addDays(startOfDay(event.endDate), 1);
    return event.startDate < dayEnd && inclusiveEnd > dayStart;
  }
  return event.startDate < dayEnd && event.endDate > dayStart;
}

function formatEventDate(event) {
  if (event.allDay) {
    if (sameDay(event.startDate, event.endDate)) return `${formatLongDate(event.startDate)} · All day`;
    return `${formatLongDate(event.startDate)} – ${formatLongDate(event.endDate)} · All day`;
  }
  if (sameDay(event.startDate, event.endDate)) {
    return `${formatLongDate(event.startDate)} · ${formatTime(event.startDate)}–${formatTime(event.endDate)}`;
  }
  return `${formatLongDate(event.startDate)}, ${formatTime(event.startDate)} – ${formatLongDate(event.endDate)}, ${formatTime(event.endDate)}`;
}

function googleCalendarUrl(event) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: calendarDateRange(event, true),
    details: event.description || "",
    location: event.location || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function outlookCalendarUrl(event) {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: event.allDay ? dateKey(event.startDate) : event.startDate.toISOString(),
    enddt: event.allDay ? dateKey(addDays(event.endDate, 1)) : event.endDate.toISOString(),
    body: event.description || "",
    location: event.location || "",
    allday: String(event.allDay),
  });
  return `https://outlook.live.com/calendar/0/action/compose?${params.toString()}`;
}

function downloadEventIcs(event) {
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ITLegend//Smart Schedule//EN",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(event.id)}@scheduling-system`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    event.allDay
      ? `DTSTART;VALUE=DATE:${formatIcsDate(event.startDate)}`
      : `DTSTART:${formatIcsUtc(event.startDate)}`,
    event.allDay
      ? `DTEND;VALUE=DATE:${formatIcsDate(addDays(event.endDate, 1))}`
      : `DTEND:${formatIcsUtc(event.endDate)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    event.description ? `DESCRIPTION:${escapeIcs(event.description)}` : "",
    event.location ? `LOCATION:${escapeIcs(event.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  downloadBlob(`${safeFilename(event.title)}.ics`, content, "text/calendar;charset=utf-8");
}

function calendarDateRange(event, compact) {
  if (event.allDay) {
    return `${formatIcsDate(event.startDate)}/${formatIcsDate(addDays(event.endDate, 1))}`;
  }
  return `${formatIcsUtc(event.startDate, compact)}/${formatIcsUtc(event.endDate, compact)}`;
}

async function copyFeedUrl() {
  try {
    await navigator.clipboard.writeText(elements.feedUrlInput.value);
    showToast("Calendar feed URL copied");
  } catch {
    elements.feedUrlInput.select();
    document.execCommand("copy");
    showToast("Calendar feed URL copied");
  }
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("toast--visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("toast--visible"), 2400);
}

function downloadBlob(filename, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function formatAgendaDate(date) {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, tomorrow)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-MY", { weekday: "short", day: "numeric", month: "short" }).format(date);
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("en-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

function formatHours(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function relativeTime(date, now) {
  const minutes = Math.round((now - date) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date) {
  const dayStart = startOfDay(date);
  const mondayIndex = (dayStart.getDay() + 6) % 7;
  return addDays(dayStart, -mondayIndex);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseLocalDate(value) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatIcsDate(date) {
  return dateKey(date).replaceAll("-", "");
}

function formatIcsUtc(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function safeFilename(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "event";
}
