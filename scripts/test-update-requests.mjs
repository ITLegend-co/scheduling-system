import assert from "node:assert/strict";
import { requestIdsMap, validateSubmissionInput } from "../functions/request-validation.js";

const valid = {
  submissionId: "21a64177-ca39-4eec-9cac-8e89bb1fc3a2",
  payload: {
    $schema: "https://itlegend-co.github.io/scheduling-system/schedule-update.schema.json",
    format: "smart-schedule-update",
    version: 1,
    createdAt: "2026-09-11T09:00:00.000Z",
    updatedAt: "2026-09-11T09:05:00.000Z",
    timezone: "Asia/Kuala_Lumpur",
    instructions: {
      mode: "changes-only",
      preserveUnmentionedEvents: true,
      autoScheduleMissingTimes: true,
      createDeadlineWhenMissing: true
    },
    note: "Keep confirmed meetings fixed.",
    changes: [
      {
        requestId: "c8b5d586-2b46-4e7b-ac06-fdaec0b21550",
        action: "add",
        type: "task",
        title: "Review inventory",
        date: "2026-09-12",
        startTime: "17:00",
        endTime: "18:00",
        priority: "normal",
        recurrence: { "frequency": "none" }
      }
    ]
  }
};

const result = validateSubmissionInput(valid);
assert.deepEqual(requestIdsMap(result.payload), { "c8b5d586-2b46-4e7b-ac06-fdaec0b21550": true });

assert.throws(
  () => validateSubmissionInput({ ...valid, submissionId: "not-a-uuid" }),
  /UUID/,
);
assert.throws(
  () => validateSubmissionInput({
    ...valid,
    payload: {
      ...valid.payload,
      instructions: { ...valid.payload.instructions, preserveUnmentionedEvents: false },
    },
  }),
  /preserveUnmentionedEvents/,
);
assert.throws(
  () => validateSubmissionInput({
    ...valid,
    payload: {
      ...valid.payload,
      changes: [valid.payload.changes[0], valid.payload.changes[0]],
    },
  }),
  /duplicated/,
);

console.log("Schedule request validation tests passed.");
