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
    let validationError = "";
    let alreadyApplied = false;
    const now = Date.now();

    const result = await requestRef.transaction((current) => {
      if (!current) {
        validationError = `Submission ${entry.submissionId} does not exist.`;
        return;
      }
      if (!sameIds(Object.keys(current.requestIds || {}), entry.requestIds)) {
        validationError = `Submission ${entry.submissionId} request IDs do not match the release receipt.`;
        return;
      }
      if (current.status === "applied") {
        if (current.appliedClaimId !== entry.claimId) {
          validationError = `Submission ${entry.submissionId} was applied by a different claim.`;
          return;
        }
        alreadyApplied = true;
        return current;
      }
      if (current.status !== "processing") {
        validationError = `Submission ${entry.submissionId} is ${current.status || "missing a status"}, not processing.`;
        return;
      }
      if (current.claimId !== entry.claimId) {
        validationError = `Submission ${entry.submissionId} is held by a different processing claim.`;
        return;
      }

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

    if (validationError) throw new Error(validationError);
    if (!result.committed) throw new Error(`Submission ${entry.submissionId} could not be confirmed.`);
    console.log(alreadyApplied
      ? `Submission ${entry.submissionId} was already confirmed as applied.`
      : `Confirmed submission ${entry.submissionId} as applied by ${commit}.`);
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
