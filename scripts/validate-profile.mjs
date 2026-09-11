import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const inputPath = resolve(process.argv[2] || "data/schedule-profile.json");
const allowedSections = new Set([
  "Work profile",
  "Tasks",
  "Ad hoc tasks",
  "Meetings",
  "IT Recurring Tasks",
  "Subscription Renewal Reminders",
  "Personal",
]);
const allowedTypes = new Set(["task", "follow-up", "reminder", "meeting", "leave", "personal", "work-pattern", "note"]);
const allowedFrequencies = new Set(["daily", "weekly", "monthly", "yearly"]);
const dateFields = ["date", "endDate", "deadline", "effectiveDate", "firstWorkingSaturday", "relatedDate"];
const timeFields = ["startTime", "endTime", "preferredStartTime"];
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

let profile;
try {
  profile = JSON.parse(readFileSync(inputPath, "utf8"));
} catch (error) {
  fail(`Cannot read valid JSON from ${inputPath}: ${error.message}`);
}

const errors = [];
if (profile.format !== "smart-schedule-profile") errors.push("format must be smart-schedule-profile");
if (profile.version !== 1) errors.push("version must be 1");
if (profile.timezone !== "Asia/Kuala_Lumpur") errors.push("timezone must be Asia/Kuala_Lumpur");
if (!profile.updatedAt || Number.isNaN(Date.parse(profile.updatedAt))) errors.push("updatedAt must be a valid ISO date-time");
if (profile.instructions?.preserveUnmentionedEvents !== true) {
  errors.push("instructions.preserveUnmentionedEvents must be true");
}
if (!Array.isArray(profile.entries)) errors.push("entries must be an array");
if (profile.rules !== undefined && (!Array.isArray(profile.rules) || profile.rules.some((rule) => typeof rule !== "string" || !rule.trim()))) {
  errors.push("rules must contain non-empty strings");
}

const ids = new Set();
for (const [index, entry] of (profile.entries || []).entries()) {
  const label = `entries[${index}]`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${label} must be an object`);
    continue;
  }
  for (const field of ["id", "section", "type", "title", "status", "details"]) {
    if (typeof entry[field] !== "string" || !entry[field].trim()) errors.push(`${label}.${field} is required`);
  }
  if (entry.id) {
    if (!idPattern.test(entry.id)) errors.push(`${label}.id must use lowercase words separated by hyphens`);
    if (ids.has(entry.id)) errors.push(`${label}.id duplicates ${entry.id}`);
    ids.add(entry.id);
  }
  if (entry.section && !allowedSections.has(entry.section)) errors.push(`${label}.section is unsupported`);
  if (entry.type && !allowedTypes.has(entry.type)) errors.push(`${label}.type is unsupported`);

  for (const field of dateFields) {
    if (entry[field] !== undefined && !isDate(entry[field])) errors.push(`${label}.${field} must be a valid YYYY-MM-DD date`);
  }
  for (const field of timeFields) {
    if (entry[field] !== undefined && !timePattern.test(entry[field])) errors.push(`${label}.${field} must use a valid HH:MM time`);
  }
  if (entry.date && entry.endDate && entry.endDate < entry.date) errors.push(`${label}.endDate cannot be before date`);
  if (entry.startTime && entry.endTime && entry.endTime <= entry.startTime) errors.push(`${label}.endTime must be after startTime`);

  if (entry.referenceUrl !== undefined) {
    try {
      const url = new URL(entry.referenceUrl);
      if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("unsupported protocol");
    } catch {
      errors.push(`${label}.referenceUrl must be an HTTP(S) URL`);
    }
  }

  if (entry.recurrence !== undefined) {
    if (!entry.recurrence || typeof entry.recurrence !== "object" || Array.isArray(entry.recurrence)) {
      errors.push(`${label}.recurrence must be an object`);
    } else {
      if (!allowedFrequencies.has(entry.recurrence.frequency)) errors.push(`${label}.recurrence.frequency is unsupported`);
      if (!Number.isInteger(entry.recurrence.interval) || entry.recurrence.interval < 1 || entry.recurrence.interval > 365) {
        errors.push(`${label}.recurrence.interval must be an integer from 1 to 365`);
      }
      if (entry.recurrence.until !== undefined && !isDate(entry.recurrence.until)) errors.push(`${label}.recurrence.until must be a valid date`);
    }
  }

  if (entry.windows !== undefined) {
    if (!Array.isArray(entry.windows) || entry.windows.some((window) =>
      !window || !timePattern.test(window.startTime || "") || !timePattern.test(window.endTime || "") || window.endTime <= window.startTime)) {
      errors.push(`${label}.windows must contain valid increasing time ranges`);
    }
  }
}

if (errors.length) {
  console.error(`Schedule profile validation failed (${errors.length}):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Schedule profile is valid: ${profile.entries.length} entry(s).`);

function isDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
