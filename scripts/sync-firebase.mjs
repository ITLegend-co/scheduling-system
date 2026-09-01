import { readFile } from "node:fs/promises";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const DATABASE_URL = "https://schedule-d2ce8-default-rtdb.asia-southeast1.firebasedatabase.app";
const PROJECT_ID = "schedule-d2ce8";
const secret = process.env.FIREBASE_SERVICE_ACCOUNT_SCHEDULE_D2CE8;

if (!secret) {
  throw new Error("GitHub secret FIREBASE_SERVICE_ACCOUNT_SCHEDULE_D2CE8 is missing.");
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(secret);
} catch {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_SCHEDULE_D2CE8 is not valid JSON.");
}

if (serviceAccount.project_id !== PROJECT_ID) {
  throw new Error(`The Firebase service account belongs to ${serviceAccount.project_id || "an unknown project"}, not ${PROJECT_ID}.`);
}

const [scheduleText, profileText, rulesText] = await Promise.all([
  readFile(new URL("../data/schedule.json", import.meta.url), "utf8"),
  readFile(new URL("../data/schedule-profile.json", import.meta.url), "utf8"),
  readFile(new URL("../database.rules.json", import.meta.url), "utf8"),
]);

const schedule = JSON.parse(scheduleText);
const profile = JSON.parse(profileText);
JSON.parse(rulesText);

if (!Array.isArray(schedule.events)) throw new Error("data/schedule.json must contain an events array.");
if (profile.format !== "smart-schedule-profile" || !Array.isArray(profile.entries)) {
  throw new Error("data/schedule-profile.json is not a valid smart schedule profile.");
}

const app = initializeApp({
  credential: cert(serviceAccount),
  databaseURL: DATABASE_URL,
});
const database = getDatabase(app);

try {
  await database.setRules(rulesText);
  await database.ref("smartSchedule").update({
    schedule: toFirebaseDocument(schedule),
    profile: toFirebaseDocument(profile),
    meta: {
      projectId: PROJECT_ID,
      source: "ITLegend-co/scheduling-system",
      sourceCommit: process.env.GITHUB_SHA || "",
      syncedAt: new Date().toISOString(),
    },
  });
  console.log(`Firebase synchronized: ${schedule.events.length} events and ${profile.entries.length} profile entries.`);
} finally {
  await deleteApp(app);
}

function toFirebaseDocument(value, path = "root") {
  if (Array.isArray(value)) {
    return value.map((item, index) => toFirebaseDocument(item, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const firebaseKey = key === "$schema" ? "schemaUrl" : key;
    if (/[.#$\/\[\]]/.test(firebaseKey)) {
      throw new Error(`Firebase cannot store key "${key}" at ${path}.`);
    }
    return [firebaseKey, toFirebaseDocument(item, `${path}.${firebaseKey}`)];
  }));
}
