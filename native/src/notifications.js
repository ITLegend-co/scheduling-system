import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";

const SCHEDULE_URL = "https://schedule-d2ce8-default-rtdb.asia-southeast1.firebasedatabase.app/smartSchedule/schedule.json";
const CHANNEL_ID = "smart-schedule-reminders";
const HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const MAX_NOTIFICATIONS = 160;
let syncing = false;

if (Capacitor.isNativePlatform()) {
  window.addEventListener("DOMContentLoaded", () => {
    initializeNotifications().catch((error) => {
      console.error("Smart Schedule notifications could not start.", error);
    });
  });
}

async function initializeNotifications() {
  const permission = await ensurePermission();
  if (permission !== "granted") {
    showStatus("Notifications are disabled. Enable them in Android settings.", true);
    return;
  }

  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: "Schedule reminders",
    description: "Reminders 15 minutes before and when scheduled events start.",
    importance: 4,
    visibility: 1,
    vibration: true
  });

  await syncNotifications(true);
  await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) syncNotifications(false);
  });
  window.setInterval(() => syncNotifications(false), 15 * 60 * 1000);
}

async function ensurePermission() {
  const current = await LocalNotifications.checkPermissions();
  if (current.display === "granted") return "granted";
  const requested = await LocalNotifications.requestPermissions();
  return requested.display;
}

async function syncNotifications(showConfirmation) {
  if (syncing) return;
  syncing = true;
  try {
    const response = await fetch(`${SCHEDULE_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Schedule returned HTTP ${response.status}.`);
    const schedule = await response.json();
    const notifications = buildNotificationPlan(schedule, Date.now());

    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map(({ id }) => ({ id }))
      });
    }

    if (notifications.length) {
      const result = await LocalNotifications.schedule({ notifications });
      if (result.warning) console.warn(result.warning.message);
    }

    if (showConfirmation) {
      const eventCount = new Set(notifications.map((item) => item.extra.eventId)).size;
      showStatus(`Notifications enabled for ${eventCount} upcoming event${eventCount === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    console.error("Unable to synchronize schedule notifications.", error);
    showStatus("Could not refresh reminders. The previous reminders remain available.", true);
  } finally {
    syncing = false;
  }
}

function buildNotificationPlan(schedule, now) {
  const events = Array.isArray(schedule?.events) ? schedule.events : [];
  const horizon = now + HORIZON_MS;
  const usedIds = new Set();
  const plan = [];

  for (const event of events) {
    if (!event?.id || !event?.title || isInactive(event.status)) continue;
    const startsAt = eventStart(event);
    if (!Number.isFinite(startsAt) || startsAt > horizon) continue;
    addReminder(plan, usedIds, event, startsAt - FIFTEEN_MINUTES, "before", now);
    addReminder(plan, usedIds, event, startsAt, "start", now);
  }

  return plan
    .sort((first, second) => first.schedule.at.getTime() - second.schedule.at.getTime())
    .slice(0, MAX_NOTIFICATIONS);
}

function addReminder(plan, usedIds, event, at, kind, now) {
  if (at <= now + 5_000) return;
  const id = uniqueNotificationId(`${event.id}:${kind}`, usedIds);
  const time = new Intl.DateTimeFormat("en-MY", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(eventStart(event)));

  plan.push({
    id,
    title: event.title,
    body: kind === "before"
      ? `Starts in 15 minutes at ${time}${event.location ? ` · ${event.location}` : ""}`
      : `Starting now${event.location ? ` · ${event.location}` : ""}`,
    channelId: CHANNEL_ID,
    schedule: { at: new Date(at), allowWhileIdle: true },
    extra: { eventId: event.id, kind }
  });
}

function eventStart(event) {
  if (event.allDay) {
    const date = String(event.start || "").slice(0, 10);
    return Date.parse(`${date}T09:00:00+08:00`);
  }
  return Date.parse(event.start);
}

function isInactive(status) {
  return new Set(["cancelled", "canceled", "completed", "done"]).has(String(status || "").toLowerCase());
}

function uniqueNotificationId(value, usedIds) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let id = hash & 0x7fffffff;
  while (usedIds.has(id)) id = (id + 1) & 0x7fffffff;
  usedIds.add(id);
  return id;
}

function showStatus(message, isError = false) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = isError ? "var(--rose)" : "var(--mint)";
  toast.classList.add("toast--visible");
  window.setTimeout(() => toast.classList.remove("toast--visible"), 4200);
}
