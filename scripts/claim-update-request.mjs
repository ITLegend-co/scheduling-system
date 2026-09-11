import { openFirebaseAdmin } from "./firebase-admin-context.mjs";

const requestedSubmissionId = process.argv[2] || "";
const processor = process.env.SCHEDULE_PROCESSOR_ID || "codex";
const claimId = process.env.SCHEDULE_CLAIM_ID || "";
const leaseMinutes = Number(process.env.SCHEDULE_PROCESSING_LEASE_MINUTES || 60);
if (requestedSubmissionId && !isSafeId(requestedSubmissionId)) throw new Error("The submission ID is invalid.");
if (!isUuid(claimId)) throw new Error("SCHEDULE_CLAIM_ID must be a UUID generated once for this processing run.");
if (!Number.isFinite(leaseMinutes) || leaseMinutes < 5 || leaseMinutes > 1440) {
  throw new Error("SCHEDULE_PROCESSING_LEASE_MINUTES must be between 5 and 1440.");
}

const admin = openFirebaseAdmin();
try {
  const root = admin.database.ref("smartSchedule/updateRequests");
  const submissionId = requestedSubmissionId || await findFirstPending(root);
  if (!submissionId) {
    console.log(JSON.stringify({ found: false, message: "No pending schedule updates." }, null, 2));
    process.exitCode = 2;
  } else {
    const now = Date.now();
    const leaseUntil = now + leaseMinutes * 60_000;
    const requestRef = root.child(submissionId);
    const result = await requestRef.transaction((current) => {
      if (!current) return;
      const leaseExpired = current.status === "processing" && Number(current.leaseUntil || 0) < now;
      if (current.status !== "pending" && !leaseExpired) return;
      return {
        ...current,
        status: "processing",
        ownerStatus: `${current.ownerUid}:processing`,
        updatedAt: now,
        claimedAt: now,
        leaseUntil,
        processingBy: processor,
        claimId,
        attemptCount: Number(current.attemptCount || 0) + 1,
      };
    }, undefined, false);

    if (!result.committed) throw new Error(`Submission ${submissionId} is no longer available to claim.`);
    const request = restoreDocumentMetadata(result.snapshot.val());
    console.log(JSON.stringify({ found: true, submissionId, request }, null, 2));
  }
} finally {
  await admin.close();
}

async function findFirstPending(root) {
  const snapshot = await root.orderByChild("status").equalTo("pending").limitToFirst(1).get();
  return snapshot.exists() ? Object.keys(snapshot.val())[0] : "";
}

function restoreDocumentMetadata(value) {
  if (!value?.payload?.schemaUrl || value.payload.$schema) return value;
  const { schemaUrl, ...payload } = value.payload;
  return { ...value, payload: { $schema: schemaUrl, ...payload } };
}

function isSafeId(value) {
  return /^[A-Za-z0-9_-]{1,180}$/.test(value);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
