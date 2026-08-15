import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const inputPath = resolve(process.argv[2] || "data/schedule.json");
const allowedStatuses = new Set(["planned", "confirmed", "tentative", "completed", "cancelled"]);
const allowedPriorities = new Set(["low", "normal", "high", "urgent"]);
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const zonedDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;

let schedule;
try {
  schedule = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (error) {
  fail(`Cannot read valid JSON from ${inputPath}: ${error.message}`);
}

const errors = [];
const warnings = [];

if (!schedule.meta || typeof schedule.meta !== "object") errors.push("meta must be an object");
if (!schedule.meta?.timezone) errors.push("meta.timezone is required");
if (!schedule.meta?.lastUpdated || Number.isNaN(new Date(schedule.meta.lastUpdated).valueOf())) {
  errors.push("meta.lastUpdated must be a valid ISO date-time");
}
if (!Array.isArray(schedule.events)) errors.push("events must be an array");

const ids = new Set();
const normalized = [];

for (const [index, event] of (schedule.events || []).entries()) {
  const label = `events[${index}]`;
  if (!event || typeof event !== "object") {
    errors.push(`${label} must be an object`);
    continue;
  }

  for (const key of ["id", "title", "start", "end"]) {
    if (!event[key]) errors.push(`${label}.${key} is required`);
  }

  if (event.id) {
    if (ids.has(event.id)) errors.push(`${label}.id duplicates “${event.id}”`);
    ids.add(event.id);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(event.id)) {
      errors.push(`${label}.id must contain only lowercase letters, numbers, and hyphens`);
    }
  }

  const status = event.status || "confirmed";
  const priority = event.priority || "normal";
  if (!allowedStatuses.has(status)) errors.push(`${label}.status must be one of: ${[...allowedStatuses].join(", ")}`);
  if (!allowedPriorities.has(priority)) errors.push(`${label}.priority must be one of: ${[...allowedPriorities].join(", ")}`);

  const datePattern = event.allDay ? dateOnlyPattern : zonedDateTimePattern;
  if (event.start && !datePattern.test(event.start)) {
    errors.push(`${label}.start must be ${event.allDay ? "YYYY-MM-DD" : "an ISO date-time with Z or a UTC offset"}`);
  }
  if (event.end && !datePattern.test(event.end)) {
    errors.push(`${label}.end must be ${event.allDay ? "YYYY-MM-DD" : "an ISO date-time with Z or a UTC offset"}`);
  }

  const start = event.start ? new Date(event.allDay ? `${event.start}T00:00:00Z` : event.start) : null;
  const end = event.end ? new Date(event.allDay ? `${event.end}T23:59:59Z` : event.end) : null;
  if (start && end && start > end) errors.push(`${label}.end must be after start`);

  if (start && end && status !== "cancelled") normalized.push({ ...event, status, start, end, index });

  if (!event.allDay && start && schedule.settings?.workingHours) {
    const localStartTime = event.start.slice(11, 16);
    const localEndTime = event.end.slice(11, 16);
    const { start: workStart, end: workEnd } = schedule.settings.workingHours;
    if (localStartTime < workStart || localEndTime > workEnd) {
      warnings.push(`${label} (“${event.title}”) is outside the configured working hours`);
    }
  }
}

for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
    const left = normalized[leftIndex];
    const right = normalized[rightIndex];
    if (left.allowOverlap || right.allowOverlap) continue;
    if (left.start < right.end && right.start < left.end) {
      errors.push(
        `Schedule conflict: events[${left.index}] (“${left.title}”) overlaps events[${right.index}] (“${right.title}”). Set allowOverlap to true only when intentional.`,
      );
    }
  }
}

if (warnings.length) {
  console.warn(`Schedule warnings (${warnings.length}):`);
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (errors.length) {
  console.error(`Schedule validation failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Schedule is valid: ${schedule.events.length} event(s), ${warnings.length} warning(s).`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
