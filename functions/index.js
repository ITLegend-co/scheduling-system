import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { logger } from "firebase-functions";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { handleScheduleConnector } from "./connector.js";
import { requestIdsMap, validateSubmissionInput } from "./request-validation.js";

const DATABASE_URL = "https://schedule-d2ce8-default-rtdb.asia-southeast1.firebasedatabase.app";
const REGION = "asia-southeast1";
const TRUSTED_ORIGINS = [
  "https://itlegend-co.github.io",
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://schedule-d2ce8.web.app",
  "https://schedule-d2ce8.firebaseapp.com",
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

initializeApp({ databaseURL: DATABASE_URL });

const callableOptions = {
  region: REGION,
  cors: TRUSTED_ORIGINS,
  maxInstances: 5,
  memory: "256MiB",
  timeoutSeconds: 30,
};

export const getScheduleOperatorStatus = onCall(callableOptions, async (request) => {
  const uid = requireAuthenticatedUser(request);
  return {
    uid,
    authorized: await isScheduleOperator(uid),
  };
});

export const scheduleMcp = onRequest(
  { ...callableOptions, timeoutSeconds: 60 },
  (request, response) => handleScheduleConnector(request, response),
);

export const submitScheduleUpdate = onCall(callableOptions, async (request) => {
  const uid = requireAuthenticatedUser(request);
  if (!(await isScheduleOperator(uid))) {
    throw new HttpsError(
      "permission-denied",
      "This Google account is not authorized to submit schedule updates.",
      { uid },
    );
  }

  let input;
  try {
    input = validateSubmissionInput(request.data);
  } catch (error) {
    throw new HttpsError("invalid-argument", error.message || "The schedule update is invalid.");
  }

  const payloadHash = createHash("sha256").update(JSON.stringify(input.payload)).digest("hex");
  const requestRef = getDatabase().ref(`smartSchedule/updateRequests/${input.submissionId}`);
  const now = Date.now();

  const result = await requestRef.transaction((current) => {
    if (current) return current;

    return {
      schemaVersion: 1,
      submissionId: input.submissionId,
      ownerUid: uid,
      ownerStatus: `${uid}:pending`,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      requestIds: requestIdsMap(input.payload),
      payloadHash,
      payload: toFirebaseDocument(input.payload),
      attemptCount: 0,
    };
  }, undefined, false);

  if (!result.committed || !result.snapshot.exists()) {
    throw new HttpsError("aborted", "The update could not be queued. Retry with the same submission ID.");
  }

  const stored = result.snapshot.val();
  if (stored.ownerUid !== uid || stored.payloadHash !== payloadHash) {
    throw new HttpsError("already-exists", "This submission ID is already used for a different update.");
  }
  logger.info("Schedule update accepted", {
    submissionId: input.submissionId,
    ownerUid: uid,
    status: stored.status,
    changeCount: input.payload.changes.length,
  });

  return {
    submissionId: input.submissionId,
    status: stored.status,
    createdAt: stored.createdAt,
  };
});

function requireAuthenticatedUser(request) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in with Google first.");
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError("permission-denied", "Use a Google account with a verified email address.");
  }
  return request.auth.uid;
}

async function isScheduleOperator(uid) {
  const snapshot = await getDatabase().ref(`smartSchedule/operators/${uid}`).get();
  return snapshot.val() === true;
}

function toFirebaseDocument(value, path = "payload") {
  if (Array.isArray(value)) return value.map((item, index) => toFirebaseDocument(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    const firebaseKey = key === "$schema" ? "schemaUrl" : key;
    if (/[.#$\/\[\]]/.test(firebaseKey)) {
      throw new HttpsError("invalid-argument", `Unsupported key ${key} at ${path}.`);
    }
    return [firebaseKey, toFirebaseDocument(item, `${path}.${firebaseKey}`)];
  }));
}
