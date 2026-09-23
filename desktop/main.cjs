const { app, BrowserWindow, Menu, Notification, Tray, nativeImage } = require("electron");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const APP_URL = "https://itlegend-co.github.io/scheduling-system/";
const SCHEDULE_URL = "https://schedule-d2ce8-default-rtdb.asia-southeast1.firebasedatabase.app/smartSchedule/schedule.json";
const POLL_INTERVAL = 5 * 60 * 1000;
const HORIZON = 7 * 24 * 60 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const APP_ID = "com.itlegend.smartschedule";

let mainWindow;
let tray;
let quitting = false;
let syncTimer;
let state = { lastUpdated: "" };
const notificationTimers = new Map();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
}

app.setAppUserModelId(APP_ID);

app.whenReady().then(async () => {
  await loadState();
  createWindow();
  createTray();

  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      enabled: true,
      name: "Smart Schedule"
    });
  }

  await synchronizeSchedule(false);
  syncTimer = setInterval(() => synchronizeSchedule(true), POLL_INTERVAL);
});

app.on("before-quit", () => {
  quitting = true;
  if (syncTimer) clearInterval(syncTimer);
  clearNotificationTimers();
});

app.on("window-all-closed", () => {
  // Keep the background process alive in the Windows notification area.
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#070d18",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(APP_URL);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({
    width: 20,
    height: 20
  });
  tray = new Tray(image);
  tray.setToolTip("Smart Schedule");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Smart Schedule", click: showWindow },
    { type: "separator" },
    { label: "Refresh reminders", click: () => synchronizeSchedule(false) },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      }
    }
  ]));
  tray.on("double-click", showWindow);
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function synchronizeSchedule(announceChanges) {
  try {
    const response = await fetch(`${SCHEDULE_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Schedule returned HTTP ${response.status}.`);
    const schedule = await response.json();
    scheduleNotifications(schedule);

    const lastUpdated = String(schedule?.meta?.lastUpdated || "");
    if (announceChanges && state.lastUpdated && lastUpdated && state.lastUpdated !== lastUpdated) {
      showNotification("Smart Schedule updated", "Your reminders were refreshed from the latest schedule.");
    }
    if (lastUpdated && state.lastUpdated !== lastUpdated) {
      state.lastUpdated = lastUpdated;
      await saveState();
    }
  } catch (error) {
    console.error("Unable to synchronize Smart Schedule reminders.", error);
  }
}

function scheduleNotifications(schedule) {
  clearNotificationTimers();
  const now = Date.now();
  const horizon = now + HORIZON;
  const events = Array.isArray(schedule?.events) ? schedule.events : [];

  for (const event of events) {
    if (!event?.id || !event?.title || isInactive(event.status)) continue;
    const startsAt = eventStart(event);
    if (!Number.isFinite(startsAt) || startsAt > horizon) continue;
    queueNotification(event, startsAt - FIFTEEN_MINUTES, "before", now);
    queueNotification(event, startsAt, "start", now);
  }
}

function queueNotification(event, notifyAt, kind, now) {
  if (notifyAt <= now + 1_000) return;
  const key = `${event.id}:${kind}`;
  const timer = setTimeout(() => {
    const startTime = new Intl.DateTimeFormat("en-MY", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kuala_Lumpur"
    }).format(new Date(eventStart(event)));
    const body = kind === "before"
      ? `Starts in 15 minutes at ${startTime}${event.location ? ` · ${event.location}` : ""}`
      : `Starting now${event.location ? ` · ${event.location}` : ""}`;
    showNotification(event.title, body);
    notificationTimers.delete(key);
  }, notifyAt - now);
  notificationTimers.set(key, timer);
}

function showNotification(title, body) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title,
    body,
    icon: path.join(__dirname, "icon.png"),
    silent: false
  });
  notification.on("click", showWindow);
  notification.show();
}

function clearNotificationTimers() {
  for (const timer of notificationTimers.values()) clearTimeout(timer);
  notificationTimers.clear();
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

function statePath() {
  return path.join(app.getPath("userData"), "notification-state.json");
}

async function loadState() {
  try {
    state = JSON.parse(await readFile(statePath(), "utf8"));
  } catch {
    state = { lastUpdated: "" };
  }
}

async function saveState() {
  await writeFile(statePath(), JSON.stringify(state, null, 2), "utf8");
}
