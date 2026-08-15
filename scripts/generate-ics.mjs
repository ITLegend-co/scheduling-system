import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const inputPath = resolve(process.argv[2] || "data/schedule.json");
const outputPath = resolve(process.argv[3] || "schedule.ics");
const schedule = JSON.parse(readFileSync(inputPath, "utf8"));
const calendarName = schedule.meta?.title || "Smart Schedule";
const timezone = schedule.meta?.timezone || "Asia/Kuala_Lumpur";
const stamp = toUtcIcs(new Date(schedule.meta?.lastUpdated || Date.now()));

const lines = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "PRODID:-//ITLegend//Smart Schedule//EN",
  `X-WR-CALNAME:${escapeIcs(calendarName)}`,
  `X-WR-TIMEZONE:${escapeIcs(timezone)}`,
  "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  "X-PUBLISHED-TTL:PT1H",
];

for (const event of [...(schedule.events || [])].sort((a, b) => String(a.start).localeCompare(String(b.start)))) {
  const allDay = Boolean(event.allDay);
  const status = event.status === "cancelled" ? "CANCELLED" : "CONFIRMED";
  lines.push(
    "BEGIN:VEVENT",
    `UID:${escapeIcs(event.id)}@itlegend-co-scheduling-system`,
    `DTSTAMP:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    allDay
      ? `DTSTART;VALUE=DATE:${dateOnlyToIcs(event.start)}`
      : `DTSTART:${toUtcIcs(new Date(event.start))}`,
    allDay
      ? `DTEND;VALUE=DATE:${dateOnlyToIcs(addOneDay(event.end))}`
      : `DTEND:${toUtcIcs(new Date(event.end))}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `STATUS:${status}`,
    `CATEGORIES:${escapeIcs(event.category || "General")}`,
    event.description ? `DESCRIPTION:${escapeIcs(event.description)}` : "",
    event.location ? `LOCATION:${escapeIcs(event.location)}` : "",
    event.url ? `URL:${event.url}` : "",
    "TRANSP:OPAQUE",
    "END:VEVENT",
  );
}

lines.push("END:VCALENDAR");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.filter(Boolean).flatMap(foldLine).join("\r\n")}\r\n`, "utf8");
console.log(`Generated ${outputPath} with ${schedule.events.length} event(s).`);

function toUtcIcs(date) {
  if (Number.isNaN(date.valueOf())) throw new Error("Invalid event date while generating ICS");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dateOnlyToIcs(value) {
  return String(value).slice(0, 10).replaceAll("-", "");
}

function addOneDay(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function escapeIcs(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line) {
  const segments = [];
  let remaining = String(line);
  let first = true;
  while (Buffer.byteLength(remaining, "utf8") > 73) {
    let index = 0;
    let bytes = 0;
    for (const character of remaining) {
      const next = Buffer.byteLength(character, "utf8");
      if (bytes + next > 73) break;
      bytes += next;
      index += character.length;
    }
    segments.push(`${first ? "" : " "}${remaining.slice(0, index)}`);
    remaining = remaining.slice(index);
    first = false;
  }
  segments.push(`${first ? "" : " "}${remaining}`);
  return segments;
}
