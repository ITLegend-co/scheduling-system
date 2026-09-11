import { openFirebaseAdmin } from "./firebase-admin-context.mjs";

const [action, uid] = process.argv.slice(2);
if (!new Set(["grant", "revoke"]).has(action)) {
  throw new Error("Usage: node scripts/manage-operator.mjs <grant|revoke> <firebase-uid>");
}
if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || "")) throw new Error("The Firebase UID is invalid.");

const admin = openFirebaseAdmin();
try {
  await admin.auth.getUser(uid);

  if (action === "grant") {
    await admin.database.ref(`smartSchedule/operators/${uid}`).set(true);
  } else {
    await admin.database.ref(`smartSchedule/operators/${uid}`).remove();
  }

  console.log(`Schedule operator access ${action === "grant" ? "granted to" : "revoked from"} ${uid}.`);
} finally {
  await admin.close();
}
