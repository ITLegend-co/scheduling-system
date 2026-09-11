const ACTIONS = new Set(["add", "update", "complete", "remove"]);
const TYPES = new Set(["task", "follow-up", "reminder", "meeting", "leave", "personal", "work-pattern", "note"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const FREQUENCIES = new Set(["none", "daily", "weekly", "monthly", "yearly"]);
const PAYLOAD_KEYS = new Set(["$schema", "format", "version", "createdAt", "updatedAt", "timezone", "instructions", "note", "changes"]);
const INSTRUCTION_KEYS = new Set(["mode", "preserveUnmentionedEvents", "autoScheduleMissingTimes", "createDeadlineWhenMissing"]);
const CHANGE_KEYS = new Set([
  "requestId", "action", "type", "title", "existingEventId", "date", "endDate", "startTime", "endTime",
  "deadline", "priority", "recurrence", "person", "location", "referenceUrl", "details",
]);
const RECURRENCE_KEYS = new Set(["frequency", "interval", "until"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,180}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validateSubmissionInput(input) {
  requireObject(input, "request");
  rejectUnexpectedKeys(input, new Set(["submissionId", "payload"]), "request");
  const submissionId = requireString(input.submissionId, "submissionId", 80);
  if (!UUID.test(submissionId)) fail("submissionId must be a UUID.");

  const payload = validatePayload(input.payload);
  return { submissionId, payload };
}

export function validatePayload(value) {
  requireObject(value, "payload");
  rejectUnexpectedKeys(value, PAYLOAD_KEYS, "payload");

  if (value.format !== "smart-schedule-update") fail("payload.format must be smart-schedule-update.");
  if (value.version !== 1) fail("payload.version must be 1.");
  requireIsoDateTime(value.createdAt, "payload.createdAt");
  requireIsoDateTime(value.updatedAt, "payload.updatedAt");
  if (value.timezone !== "Asia/Kuala_Lumpur") fail("payload.timezone must be Asia/Kuala_Lumpur.");
  optionalString(value.$schema, "payload.$schema", 500);
  optionalString(value.note, "payload.note", 1000);

  requireObject(value.instructions, "payload.instructions");
  rejectUnexpectedKeys(value.instructions, INSTRUCTION_KEYS, "payload.instructions");
  if (value.instructions.mode !== "changes-only") fail("payload.instructions.mode must be changes-only.");
  if (value.instructions.preserveUnmentionedEvents !== true) {
    fail("payload.instructions.preserveUnmentionedEvents must be true.");
  }
  requireBoolean(value.instructions.autoScheduleMissingTimes, "payload.instructions.autoScheduleMissingTimes");
  requireBoolean(value.instructions.createDeadlineWhenMissing, "payload.instructions.createDeadlineWhenMissing");

  if (!Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 50) {
    fail("payload.changes must contain between 1 and 50 changes.");
  }

  const requestIds = new Set();
  value.changes.forEach((change, index) => {
    validateChange(change, index);
    if (requestIds.has(change.requestId)) fail(`payload.changes[${index}].requestId is duplicated.`);
    requestIds.add(change.requestId);
  });

  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > 128 * 1024) {
    fail("The update request is larger than 128 KB.");
  }

  return JSON.parse(serialized);
}

export function requestIdsMap(payload) {
  return Object.fromEntries(payload.changes.map((change) => [change.requestId, true]));
}

function validateChange(change, index) {
  const label = `payload.changes[${index}]`;
  requireObject(change, label);
  rejectUnexpectedKeys(change, CHANGE_KEYS, label);

  const requestId = requireString(change.requestId, `${label}.requestId`, 180);
  if (!SAFE_ID.test(requestId)) fail(`${label}.requestId contains unsupported characters.`);
  if (!ACTIONS.has(change.action)) fail(`${label}.action is not supported.`);
  if (!TYPES.has(change.type)) fail(`${label}.type is not supported.`);
  requireString(change.title, `${label}.title`, 140);
  if (!PRIORITIES.has(change.priority)) fail(`${label}.priority is not supported.`);

  optionalString(change.existingEventId, `${label}.existingEventId`, 180);
  optionalDate(change.date, `${label}.date`);
  optionalDate(change.endDate, `${label}.endDate`);
  optionalDate(change.deadline, `${label}.deadline`);
  optionalTime(change.startTime, `${label}.startTime`);
  optionalTime(change.endTime, `${label}.endTime`);
  optionalString(change.person, `${label}.person`, 120);
  optionalString(change.location, `${label}.location`, 160);
  optionalString(change.details, `${label}.details`, 2000);

  if (change.referenceUrl !== undefined) {
    const link = requireString(change.referenceUrl, `${label}.referenceUrl`, 500);
    let url;
    try {
      url = new URL(link);
    } catch {
      fail(`${label}.referenceUrl must be a valid URL.`);
    }
    if (!new Set(["http:", "https:"]).has(url.protocol)) fail(`${label}.referenceUrl must use http or https.`);
  }

  if (change.endDate && change.date && change.endDate < change.date) fail(`${label}.endDate cannot be before date.`);
  if (change.endTime && !change.startTime) fail(`${label}.startTime is required when endTime is provided.`);
  if ((change.startTime || change.endTime) && !change.date && change.type !== "work-pattern") {
    fail(`${label}.date is required when a time is provided.`);
  }

  if (change.recurrence !== undefined) {
    requireObject(change.recurrence, `${label}.recurrence`);
    rejectUnexpectedKeys(change.recurrence, RECURRENCE_KEYS, `${label}.recurrence`);
    if (!FREQUENCIES.has(change.recurrence.frequency)) fail(`${label}.recurrence.frequency is not supported.`);
    if (change.recurrence.interval !== undefined) {
      if (!Number.isInteger(change.recurrence.interval) || change.recurrence.interval < 1 || change.recurrence.interval > 365) {
        fail(`${label}.recurrence.interval must be an integer from 1 to 365.`);
      }
    }
    optionalDate(change.recurrence.until, `${label}.recurrence.until`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
}

function rejectUnexpectedKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) fail(`${label} contains unsupported field ${unexpected[0]}.`);
}

function requireString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string.`);
  if (value.length > maxLength) fail(`${label} must be ${maxLength} characters or fewer.`);
  return value;
}

function optionalString(value, label, maxLength) {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length > maxLength) fail(`${label} must be ${maxLength} characters or fewer.`);
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be true or false.`);
}

function requireIsoDateTime(value, label) {
  const text = requireString(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text))) fail(`${label} must be an ISO date-time.`);
}

function optionalDate(value, label) {
  if (value === undefined) return;
  const match = requireString(value, label, 10).match(DATE);
  if (!match) fail(`${label} must use YYYY-MM-DD.`);
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) {
    fail(`${label} is not a valid calendar date.`);
  }
}

function optionalTime(value, label) {
  if (value === undefined) return;
  if (!TIME.test(requireString(value, label, 5))) fail(`${label} must use HH:MM.`);
}

function fail(message) {
  throw new TypeError(message);
}
