import { readFile } from "node:fs/promises";
import { openFirebaseAdmin } from "./firebase-admin-context.mjs";

const commit = process.env.GITHUB_SHA || "";
if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error("GITHUB_SHA is missing or invalid.");

const receipt = JSON.parse(await readFile(new URL("../data/update-release.json", import.meta.url), "utf8"));
if (receipt.format !== "smart-schedule-release-receipt" || receipt.version !== 1 || !Array.isArray(receipt.submissions)) {
  throw new Error("data/update-release.json is not a valid release receipt.");
}
if (!receipt.submissions.length) {
  console.log("No submitted schedule updates are attached to this release.");
  process.exit(0);
}

const admin = openFirebaseAdmin();
try {
  const metaSnapshot = await admin.database.ref("smartSchedule/meta").get();
  const sourceCommit = metaSnapshot.child("sourceCommit").val();
  if (sourceCommit !== commit) {
    throw new Error(`Firebase is synchronized to ${sourceCommit || "no commit"}, not ${commit}.`);
  }

  for (const entry of receipt.submissions) {
    validateReceiptEntry(entry);
    const requestRef = admin.database.ref(`smartSchedule/updateRequests/${entry.submissionId}`);
    const now = Date.now();

    const result = await requestRef.transaction((current) => {
      if (!current) return current;
      if (!sameIds(Object.keys(current.requestIds || {}), entry.requestIds)) return current;
      if (current.status === "applied") return current;
      if (current.status !== "processing" || current.claimId !== entry.claimId) return current;

      const { claimedAt, leaseUntil, processingBy, claimId, ...rest } = current;
      return {
        ...rest,
        status: "applied",
        ownerStatus: `${current.ownerUid}:applied`,
        updatedAt: now,
        appliedAt: now,
        appliedCommit: commit,
        appliedClaimId: entry.claimId,
      };
    }, undefined, false);

    if (!result.committed) throw new Error(`Submission ${entry.submissionId} could not be confirmed.`);
    const stored = result.snapshot.val();
    if (!stored) throw new Error(`Submission ${entry.submissionId} does not exist.`);
    if (!sameIds(Object.keys(stored.requestIds || {}), entry.requestIds)) {
      throw new Error(`Submission ${entry.submissionId} request IDs do not match the release receipt.`);
    }
    if (stored.status !== "applied") {
      throw new Error(`Submission ${entry.submissionId} is ${stored.status || "missing a status"}, not applied.`);
    }
    if (stored.appliedClaimId !== entry.claimId) {
      throw new Error(`Submission ${entry.submissionId} was applied by a different claim.`);
    }
    console.log(`Confirmed submission ${entry.submissionId} as applied by ${commit}.`);
  }
} finally {
  await admin.close();
}

function validateReceiptEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Release receipt entries must be objects.");
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(entry.submissionId || "")) throw new Error("A release receipt submission ID is invalid.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.claimId || "")) {
    throw new Error(`Submission ${entry.submissionId} must include the exact UUID claim ID.`);
  }
  if (!Array.isArray(entry.requestIds) || !entry.requestIds.length || new Set(entry.requestIds).size !== entry.requestIds.length) {
    throw new Error(`Submission ${entry.submissionId} must list unique request IDs.`);
  }
  if (entry.requestIds.some((id) => !/^[A-Za-z0-9_-]{1,180}$/.test(id))) {
    throw new Error(`Submission ${entry.submissionId} contains an invalid request ID.`);
  }
}

function sameIds(first, second) {
  if (first.length !== second.length) return false;
  const expected = [...second].sort();
  return [...first].sort().every((id, index) => id === expected[index]);
}
