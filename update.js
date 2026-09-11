const STORAGE_KEY = "smart-schedule-update-draft-v1";
const FORMAT_NAME = "smart-schedule-update";
const FORMAT_VERSION = 1;
const PROFILE_FORMAT_NAME = "smart-schedule-profile";
const PROFILE_URL = "data/schedule-profile.json";
const ACTIVE_SUBMISSION_STATUSES = new Set(["submitting", "pending", "processing", "retry"]);
const SERVER_SUBMISSION_STATUSES = new Set(["pending", "processing", "applied", "failed"]);
let firebaseClientPromise;

const state = {
  changes: [],
  editingId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  submissions: [],
  submissionWatchers: new Map(),
  user: null,
  authReady: false,
  operatorAuthorized: false,
  profile: null,
};

const elements = {
  form: document.querySelector("#changeForm"),
  formHeading: document.querySelector("#formHeading"),
  formMessage: document.querySelector("#formMessage"),
  addChangeButton: document.querySelector("#addChangeButton"),
  resetFormButton: document.querySelector("#resetFormButton"),
  action: document.querySelector("#action"),
  recurrence: document.querySelector("#recurrence"),
  existingIdField: document.querySelector("#existingIdField"),
  repeatUntilField: document.querySelector("#repeatUntilField"),
  changeList: document.querySelector("#changeList"),
  changeCount: document.querySelector("#changeCount"),
  queueEmpty: document.querySelector("#queueEmpty"),
  autoSchedule: document.querySelector("#autoSchedule"),
  createDeadline: document.querySelector("#createDeadline"),
  requestNote: document.querySelector("#requestNote"),
  jsonPreview: document.querySelector("#jsonPreview"),
  importFile: document.querySelector("#importFile"),
  copyJsonButton: document.querySelector("#copyJsonButton"),
  downloadJsonButton: document.querySelector("#downloadJsonButton"),
  submitFirebaseButton: document.querySelector("#submitFirebaseButton"),
  submitFirebaseLabel: document.querySelector("#submitFirebaseLabel"),
  clearDraftButton: document.querySelector("#clearDraftButton"),
  draftStatus: document.querySelector("#draftStatus"),
  toast: document.querySelector("#toast"),
  submissionAccess: document.querySelector(".submission-access"),
  submissionStatus: document.querySelector("#submissionStatus"),
  authHeading: document.querySelector("#authHeading"),
  authStatus: document.querySelector("#authStatus"),
  authButton: document.querySelector("#authButton"),
  profileStatus: document.querySelector("#profileStatus"),
  profileSearch: document.querySelector("#profileSearch"),
  profileCount: document.querySelector("#profileCount"),
  profileRules: document.querySelector("#profileRules"),
  profileSections: document.querySelector("#profileSections"),
  profileEmpty: document.querySelector("#profileEmpty"),
  profileJsonPreview: document.querySelector("#profileJsonPreview"),
  copyProfileButton: document.querySelector("#copyProfileButton"),
  downloadProfileButton: document.querySelector("#downloadProfileButton"),
};

loadDraft();
bindEvents();
updateConditionalFields();
render();
loadProfile();
initializeSubmissionAccess();

function bindEvents() {
  elements.form.addEventListener("submit", submitChange);
  elements.form.addEventListener("input", () => {
    clearFormError();
    saveDraft();
  });
  elements.form.addEventListener("change", () => {
    updateConditionalFields();
    saveDraft();
  });
  elements.resetFormButton.addEventListener("click", resetForm);
  elements.autoSchedule.addEventListener("change", updatePreferences);
  elements.createDeadline.addEventListener("change", updatePreferences);
  elements.requestNote.addEventListener("input", updatePreferences);
  elements.importFile.addEventListener("change", importJson);
  elements.copyJsonButton.addEventListener("click", copyJson);
  elements.downloadJsonButton.addEventListener("click", downloadJson);
  elements.submitFirebaseButton.addEventListener("click", submitQueuedChanges);
  elements.authButton.addEventListener("click", toggleAuthentication);
  elements.clearDraftButton.addEventListener("click", clearDraft);
  elements.profileSearch.addEventListener("input", renderProfile);
  elements.copyProfileButton.addEventListener("click", copyProfileJson);
  elements.downloadProfileButton.addEventListener("click", downloadProfileJson);
}

function loadFirebaseClient() {
  firebaseClientPromise ||= import("./firebase-client.js");
  return firebaseClientPromise;
}

async function initializeSubmissionAccess() {
  try {
    const firebase = await loadFirebaseClient();
    firebase.watchAuth(
      (user) => handleAuthState(user),
      (error) => showAuthError(error),
    );
  } catch (error) {
    showAuthError(error);
  }
}

async function handleAuthState(user) {
  stopSubmissionWatchers();
  state.user = user;
  state.authReady = true;
  state.operatorAuthorized = false;

  if (!user) {
    elements.submissionAccess.classList.remove("submission-access--error");
    elements.authHeading.textContent = "Sign in to submit";
    elements.authStatus.textContent = "Use your approved Google account. JSON download remains available as a backup.";
    elements.authButton.textContent = "Sign in with Google";
    elements.authButton.disabled = false;
    render();
    return;
  }

  elements.submissionAccess.classList.remove("submission-access--error");
  elements.authHeading.textContent = `Signed in as ${user.displayName || user.email || "Google user"}`;
  elements.authStatus.textContent = "Checking schedule submission access…";
  elements.authButton.textContent = "Sign out";
  elements.authButton.disabled = false;
  render();

  try {
    const firebase = await loadFirebaseClient();
    const result = await firebase.getScheduleOperatorStatus();
    if (state.user?.uid !== user.uid) return;
    state.operatorAuthorized = result.authorized === true;
    if (state.operatorAuthorized) {
      elements.authHeading.textContent = `Ready as ${user.displayName || user.email || "schedule operator"}`;
      elements.authStatus.textContent = "Authenticated submissions are enabled for this account.";
      elements.submissionAccess.classList.remove("submission-access--error");
    } else {
      elements.authHeading.textContent = "Operator approval needed";
      elements.authStatus.textContent = `Signed in, but this account is not approved yet. Firebase UID: ${result.uid || user.uid}`;
      elements.submissionAccess.classList.add("submission-access--error");
    }
    watchTrackedSubmissions();
    render();
  } catch (error) {
    if (state.user?.uid === user.uid) showAuthError(error, true);
  }
}

async function toggleAuthentication() {
  elements.authButton.disabled = true;
  try {
    const firebase = await loadFirebaseClient();
    if (state.user) {
      await firebase.signOutUser();
    } else {
      await firebase.signInWithGoogle();
    }
  } catch (error) {
    elements.authButton.disabled = false;
    if (error?.code !== "auth/popup-closed-by-user") showAuthError(error, true);
  }
}

function showAuthError(error, keepSignedIn = false) {
  console.error("Firebase authentication is unavailable.", error);
  state.authReady = true;
  state.operatorAuthorized = false;
  elements.submissionAccess.classList.add("submission-access--error");
  elements.authHeading.textContent = keepSignedIn && state.user ? "Could not verify operator access" : "Secure submission unavailable";
  elements.authStatus.textContent = friendlyFirebaseError(error);
  elements.authButton.textContent = state.user ? "Sign out" : "Try sign-in again";
  elements.authButton.disabled = false;
  render();
}

async function submitQueuedChanges() {
  if (!state.user) {
    await toggleAuthentication();
    return;
  }
  if (!state.operatorAuthorized) {
    showToast(`Approve Firebase UID ${state.user.uid} before submitting.`, true);
    return;
  }

  const retry = state.submissions.find((submission) =>
    submission.status === "retry" && submission.ownerUid === state.user.uid && submission.payload,
  );
  if (retry) {
    await sendSubmission(retry);
    return;
  }

  const changes = state.changes.filter((change) => !isRequestLocked(change.requestId));
  if (!changes.length) {
    showToast(state.changes.length ? "All changes are already submitted" : "Add at least one change first", true);
    return;
  }

  state.updatedAt = new Date().toISOString();
  const submission = {
    submissionId: createId(),
    ownerUid: state.user.uid,
    requestIds: changes.map((change) => change.requestId),
    submittedAt: new Date().toISOString(),
    status: "submitting",
    payload: removeEmpty(buildExport(changes)),
    error: "",
  };
  state.submissions.unshift(submission);
  state.submissions = state.submissions.slice(0, 12);
  saveDraft();
  render();
  await sendSubmission(submission);
}

async function sendSubmission(submission) {
  submission.status = "submitting";
  submission.error = "";
  saveDraft();
  render();

  try {
    const firebase = await loadFirebaseClient();
    const result = await firebase.submitScheduleUpdate(submission.submissionId, submission.payload);
    submission.status = SERVER_SUBMISSION_STATUSES.has(result.status) ? result.status : "pending";
    submission.submittedAt = submission.submittedAt || new Date().toISOString();
    submission.error = "";
    attachSubmissionWatcher(submission);
    saveDraft();
    render();
    showToast("Update submitted securely · draft kept until deployment is confirmed");
  } catch (error) {
    console.error("Schedule update submission failed.", error);
    submission.status = "retry";
    submission.error = friendlyFirebaseError(error);
    saveDraft();
    render();
    showToast(`${submission.error} Retry uses the same request ID.`, true);
  }
}

function watchTrackedSubmissions() {
  state.submissions
    .filter((submission) => submission.ownerUid === state.user?.uid && new Set(["pending", "processing"]).has(submission.status))
    .forEach(attachSubmissionWatcher);
}

async function attachSubmissionWatcher(submission) {
  if (!state.user || submission.ownerUid !== state.user.uid || state.submissionWatchers.has(submission.submissionId)) return;
  try {
    const firebase = await loadFirebaseClient();
    const unsubscribe = firebase.watchUpdateRequest(
      submission.submissionId,
      (request) => handleSubmissionStatus(submission.submissionId, request),
      (error) => {
        if (state.user) console.warn(`Status listener stopped for ${submission.submissionId}.`, error);
      },
    );
    state.submissionWatchers.set(submission.submissionId, unsubscribe);
  } catch (error) {
    console.warn(`Could not watch submission ${submission.submissionId}.`, error);
  }
}

function handleSubmissionStatus(submissionId, request) {
  const submission = state.submissions.find((item) => item.submissionId === submissionId);
  if (!submission || !SERVER_SUBMISSION_STATUSES.has(request?.status)) return;

  const serverRequestIds = Object.keys(request.requestIds || {});
  if (!sameStringSet(serverRequestIds, submission.requestIds)) {
    submission.status = "failed";
    submission.error = "The server receipt did not match this local draft, so nothing was cleared.";
    stopSubmissionWatcher(submissionId);
    saveDraft();
    render();
    return;
  }

  submission.status = request.status;
  submission.error = request.errorMessage || "";
  submission.appliedAt = request.appliedAt || 0;
  submission.appliedCommit = request.appliedCommit || "";

  if (request.status === "applied") {
    applyConfirmedSubmission(submission);
    return;
  }
  if (request.status === "failed") stopSubmissionWatcher(submissionId);
  saveDraft();
  render();
}

function applyConfirmedSubmission(submission) {
  const appliedIds = new Set(submission.requestIds);
  const before = state.changes.length;
  state.changes = state.changes.filter((change) => !appliedIds.has(change.requestId));
  delete submission.payload;
  submission.error = "";
  stopSubmissionWatcher(submission.submissionId);

  if (state.editingId && appliedIds.has(state.editingId)) resetForm(false);
  if (!state.changes.length) {
    state.createdAt = new Date().toISOString();
    state.updatedAt = state.createdAt;
    elements.requestNote.value = "";
  }
  saveDraft();
  render();
  if (before !== state.changes.length) showToast("Deployed changes confirmed and cleared from this browser");
}

function stopSubmissionWatcher(submissionId) {
  const unsubscribe = state.submissionWatchers.get(submissionId);
  if (unsubscribe) unsubscribe();
  state.submissionWatchers.delete(submissionId);
}

function stopSubmissionWatchers() {
  [...state.submissionWatchers.keys()].forEach(stopSubmissionWatcher);
}

function isRequestLocked(requestId) {
  return state.submissions.some((submission) =>
    ACTIVE_SUBMISSION_STATUSES.has(submission.status) && submission.requestIds.includes(requestId),
  );
}

function requestStatus(requestId) {
  return state.submissions.find((submission) =>
    ACTIVE_SUBMISSION_STATUSES.has(submission.status) && submission.requestIds.includes(requestId),
  )?.status || "";
}

function sameStringSet(first, second) {
  if (first.length !== second.length) return false;
  const expected = new Set(second);
  return first.every((value) => expected.has(value));
}

async function loadProfile() {
  try {
    const firebase = await loadFirebaseClient();
    const profile = await firebase.readProfile();
    applyProfile(profile, "Firebase");

    firebase.watchProfile(
      (nextProfile) => {
        try {
          applyProfile(nextProfile, "Firebase");
        } catch (error) {
          console.error("Firebase returned an invalid schedule profile.", error);
        }
      },
      (error) => console.warn("Firebase profile listener stopped.", error),
    );
  } catch (firebaseError) {
    console.warn("Firebase profile unavailable; loading the published backup.", firebaseError);
    await loadBackupProfile();
  }
}

async function loadBackupProfile() {
  try {
    const response = await fetch(`${PROFILE_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Profile request failed with status ${response.status}`);
    applyProfile(await response.json(), "Backup JSON");
  } catch (error) {
    showProfileLoadError(error);
  }
}

function applyProfile(profile, sourceLabel) {
  if (profile.format !== PROFILE_FORMAT_NAME || Number(profile.version) !== 1 || !Array.isArray(profile.entries)) {
    throw new Error("The master profile JSON has an unsupported format.");
  }

  state.profile = profile;
  elements.profileStatus.classList.remove("profile-status--error");
  elements.profileStatus.textContent = `${sourceLabel} · Updated ${formatProfileTimestamp(profile.updatedAt)}`;
  elements.profileJsonPreview.textContent = JSON.stringify(profile, null, 2);
  elements.copyProfileButton.disabled = false;
  elements.downloadProfileButton.disabled = false;
  renderProfileRules();
  renderProfile();
}

function showProfileLoadError(error) {
  elements.profileStatus.textContent = "The master JSON profile could not be loaded. Refresh the page to try again.";
  elements.profileStatus.classList.add("profile-status--error");
  elements.profileCount.textContent = "Unavailable";
  elements.profileEmpty.hidden = false;
  elements.profileEmpty.textContent = error.message || "Unable to load the profile.";
}

function renderProfileRules() {
  const rules = Array.isArray(state.profile?.rules) ? state.profile.rules : [];
  if (!rules.length) {
    elements.profileRules.hidden = true;
    return;
  }

  const heading = document.createElement("strong");
  heading.textContent = "Scheduling rules";
  const list = document.createElement("div");
  rules.forEach((rule) => {
    const item = document.createElement("span");
    item.textContent = rule;
    list.append(item);
  });
  elements.profileRules.replaceChildren(heading, list);
  elements.profileRules.hidden = false;
}

function renderProfile() {
  if (!state.profile) return;
  const query = elements.profileSearch.value.trim().toLocaleLowerCase();
  const entries = state.profile.entries.filter((entry) => !query || JSON.stringify(entry).toLocaleLowerCase().includes(query));
  const preferredSections = [
    "Work profile",
    "Tasks",
    "Ad hoc tasks",
    "Meetings",
    "IT Recurring Tasks",
    "Subscription Renewal Reminders",
    "Personal",
  ];
  const availableSections = [...new Set(entries.map((entry) => entry.section || "Other"))];
  const sectionOrder = [
    ...preferredSections.filter((name) => availableSections.includes(name)),
    ...availableSections.filter((name) => !preferredSections.includes(name)),
  ];
  const sections = sectionOrder
    .map((name) => [name, entries.filter((entry) => entry.section === name)])
    .filter(([, items]) => items.length);

  const sectionElements = sections.map(([name, items]) => {
    const section = document.createElement("section");
    section.className = "profile-section";

    const heading = document.createElement("div");
    heading.className = "profile-section__heading";
    const title = document.createElement("h3");
    title.textContent = name;
    const count = document.createElement("span");
    count.textContent = String(items.length);
    heading.append(title, count);

    const grid = document.createElement("div");
    grid.className = "profile-card-grid";
    grid.append(...items.map(createProfileCard));
    section.append(heading, grid);
    return section;
  });

  elements.profileSections.replaceChildren(...sectionElements);
  elements.profileCount.textContent = `${entries.length} of ${state.profile.entries.length} items`;
  elements.profileEmpty.hidden = entries.length > 0;
}

function createProfileCard(entry) {
  const card = document.createElement("article");
  card.className = "profile-card";

  const badges = document.createElement("div");
  badges.className = "profile-card__badges";
  badges.append(createBadge(entry.type), createBadge(entry.status, `profile-badge--${entry.status}`));

  const title = document.createElement("h4");
  title.textContent = entry.title;

  const summary = document.createElement("p");
  summary.className = "profile-card__summary";
  summary.textContent = profileEntrySummary(entry);

  const details = document.createElement("p");
  details.className = "profile-card__details";
  details.textContent = entry.details;

  const footer = document.createElement("div");
  footer.className = "profile-card__footer";
  if (entry.referenceUrl) {
    const link = document.createElement("a");
    link.href = entry.referenceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open reference";
    footer.append(link);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button--ghost button--compact profile-card__button";
  button.textContent = "Create update";
  button.addEventListener("click", () => prefillFromProfile(entry));
  footer.append(button);

  card.append(badges, title);
  if (summary) card.append(summary);
  card.append(details, footer);
  return card;
}

function profileEntrySummary(entry) {
  const parts = [];
  const date = entry.date || entry.effectiveDate;
  if (date) {
    let dateSummary = formatDate(date);
    if (entry.endDate && entry.endDate !== date) dateSummary += `–${formatDate(entry.endDate)}`;
    if (entry.startTime) dateSummary += ` · ${formatTime(entry.startTime)}`;
    if (entry.endTime) dateSummary += `–${formatTime(entry.endTime)}`;
    parts.push(dateSummary);
  } else if (entry.startTime) {
    let timeSummary = formatTime(entry.startTime);
    if (entry.endTime) timeSummary += `–${formatTime(entry.endTime)}`;
    parts.push(timeSummary);
  }
  if (entry.deadline) parts.push(`Due ${formatDate(entry.deadline)}`);
  if (entry.person) parts.push(entry.person);
  if (entry.location) parts.push(entry.location);
  if (entry.recurrence) parts.push(formatRecurrence(entry.recurrence));
  return parts.join(" · ");
}

function prefillFromProfile(entry) {
  const target = {
    action: "update",
    type: entry.type || "task",
    title: entry.title,
    existingEventId: entry.id || "",
  };
  const matchingQueuedChanges = state.changes.filter((change) => sameUpdateTarget(change, target) && !isRequestLocked(change.requestId));
  const queuedChange = matchingQueuedChanges[matchingQueuedChanges.length - 1] || null;

  resetForm(false);
  state.editingId = queuedChange?.requestId || null;
  setFormValue("action", "update");
  setFormValue("type", entry.type || "task");
  setFormValue("title", entry.title);
  setFormValue("existingEventId", entry.id || queuedChange?.existingEventId || "");
  setFormValue("date", entry.date || entry.effectiveDate || "");
  setFormValue("endDate", entry.endDate || "");
  setFormValue("startTime", entry.startTime || "");
  setFormValue("endTime", entry.endTime || "");
  setFormValue("deadline", entry.deadline || "");
  setFormValue("priority", entry.priority || "normal");
  setFormValue("recurrence", recurrenceValue(entry.recurrence));
  setFormValue("repeatUntil", entry.recurrence?.until || "");
  setFormValue("person", entry.person || "");
  setFormValue("location", entry.location || "");
  setFormValue("referenceUrl", entry.referenceUrl || "");
  setFormValue("details", profileEntryDetails(entry));

  if (queuedChange) {
    replaceMatchingUpdates(readForm(), queuedChange.requestId);
    state.updatedAt = new Date().toISOString();
    render();
  }

  elements.formHeading.textContent = `Update: ${entry.title}`;
  elements.addChangeButton.lastChild.textContent = queuedChange ? " Save this change" : " Add this change";
  updateConditionalFields();
  saveDraft();
  document.querySelector("#createUpdate").scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#title").focus({ preventScroll: true });
  showToast(
    queuedChange
      ? matchingQueuedChanges.length > 1
        ? "Pending duplicates merged and refreshed with the current task details"
        : "Pending change refreshed with the current task details"
      : "Current item copied into the update form",
  );
}

function profileEntryDetails(entry) {
  const details = [entry.details];
  if (entry.windows?.length) {
    details.push(`Time windows: ${entry.windows.map((window) => `${window.startTime}–${window.endTime}`).join(" or ")}.`);
  }
  if (entry.preferredStartTime) details.push(`Preferred start time: ${entry.preferredStartTime}.`);
  if (entry.firstWorkingSaturday) details.push(`First working Saturday: ${entry.firstWorkingSaturday}.`);
  return details.join("\n\n");
}

async function copyProfileJson() {
  if (!state.profile) return;
  const content = JSON.stringify(state.profile, null, 2);
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  showToast("Master JSON copied");
}

function downloadProfileJson() {
  if (!state.profile) return;
  downloadBlob("schedule-profile.json", `${JSON.stringify(state.profile, null, 2)}\n`, "application/json;charset=utf-8");
  showToast("Master JSON profile downloaded");
}

function submitChange(event) {
  event.preventDefault();
  clearFormError();

  const change = readForm();
  const error = validateChange(change);
  if (error) {
    showFormError(error.message, error.field);
    return;
  }
  if (state.editingId && isRequestLocked(state.editingId)) {
    showFormError("This change is already submitted and cannot be edited until processing finishes.", "title");
    return;
  }

  if (state.editingId) {
    const index = state.changes.findIndex((item) => item.requestId === state.editingId);
    let mergedCount = 0;
    if (index !== -1) {
      const replacement = { ...change, requestId: state.editingId };
      if (replacement.action === "update") {
        mergedCount = replaceMatchingUpdates(replacement, state.editingId);
      } else {
        state.changes[index] = replacement;
      }
    }
    showToast(mergedCount > 1 ? "Change updated and duplicate task updates merged" : "Change updated");
  } else {
    const existingIndex = state.changes.findIndex((item) => sameUpdateTarget(item, change) && !isRequestLocked(item.requestId));
    if (existingIndex !== -1) {
      const requestId = state.changes[existingIndex].requestId;
      const mergedCount = replaceMatchingUpdates({ ...change, requestId }, requestId);
      showToast(mergedCount > 1 ? "Existing task updates merged and replaced" : "Existing task update replaced");
    } else {
      state.changes.push(change);
      showToast("Change added to the JSON file");
    }
  }

  state.updatedAt = new Date().toISOString();
  resetForm(false);
  saveDraft();
  render();
}

function readForm() {
  const data = new FormData(elements.form);
  const recurrence = parseRecurrence(data.get("recurrence"));

  return {
    requestId: state.editingId || createId(),
    action: value(data, "action"),
    type: value(data, "type"),
    title: value(data, "title"),
    existingEventId: value(data, "existingEventId"),
    date: value(data, "date"),
    endDate: value(data, "endDate"),
    startTime: value(data, "startTime"),
    endTime: value(data, "endTime"),
    deadline: value(data, "deadline"),
    priority: value(data, "priority") || "normal",
    recurrence: {
      ...recurrence,
      until: recurrence.frequency === "none" ? "" : value(data, "repeatUntil"),
    },
    person: value(data, "person"),
    location: value(data, "location"),
    referenceUrl: value(data, "referenceUrl"),
    details: value(data, "details"),
  };
}

function validateChange(change) {
  if (!change.title) return { message: "Add a clear title for this schedule change.", field: "title" };
  if ((change.startTime || change.endTime) && !change.date && change.type !== "work-pattern") {
    return { message: "Choose a date when you provide a start or end time.", field: "date" };
  }
  if (change.endDate && !change.date) {
    return { message: "Choose a start date when you provide an end date.", field: "date" };
  }
  if (change.date && change.endDate && change.endDate < change.date) {
    return { message: "The end date cannot be earlier than the start date.", field: "endDate" };
  }
  if (change.endTime && !change.startTime) {
    return { message: "Add a start time, or leave both time fields blank.", field: "startTime" };
  }
  if (change.referenceUrl) {
    try {
      const url = new URL(change.referenceUrl);
      if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Unsupported protocol");
    } catch {
      return { message: "Enter a complete reference link beginning with http:// or https://.", field: "referenceUrl" };
    }
  }
  return null;
}

function sameUpdateTarget(first, second) {
  if (first?.action !== "update" || second?.action !== "update") return false;

  const firstId = normalizeTargetValue(first.existingEventId);
  const secondId = normalizeTargetValue(second.existingEventId);
  if (firstId && secondId) return firstId === secondId;

  return (
    normalizeTargetValue(first.type) === normalizeTargetValue(second.type) &&
    normalizeTargetValue(first.title) === normalizeTargetValue(second.title)
  );
}

function normalizeTargetValue(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function replaceMatchingUpdates(change, requestId = change.requestId) {
  if (change?.action !== "update") return 0;

  const matchingIndexes = state.changes
    .map((item, index) => sameUpdateTarget(item, change) && (!isRequestLocked(item.requestId) || item.requestId === requestId) ? index : -1)
    .filter((index) => index !== -1);
  if (!matchingIndexes.length) return 0;

  const insertIndex = matchingIndexes[0];
  const matchingIndexSet = new Set(matchingIndexes);
  state.changes = state.changes.filter((_, index) => !matchingIndexSet.has(index));
  state.changes.splice(insertIndex, 0, { ...change, requestId });
  return matchingIndexes.length;
}

function updateConditionalFields() {
  elements.existingIdField.hidden = elements.action.value === "add";
  elements.repeatUntilField.hidden = elements.recurrence.value === "none";
}

function render() {
  renderChanges();
  renderPreview();
  renderSubmissionStatus();
  updateSubmitButton();
  elements.changeCount.textContent = String(state.changes.length);
  elements.queueEmpty.hidden = state.changes.length > 0;
  elements.changeList.hidden = state.changes.length === 0;
}

function updateSubmitButton() {
  const retry = state.submissions.some((submission) =>
    submission.status === "retry" && submission.ownerUid === state.user?.uid && submission.payload,
  );
  const busy = state.submissions.some((submission) =>
    submission.status === "submitting" && submission.ownerUid === state.user?.uid,
  );
  const readyCount = state.changes.filter((change) => !isRequestLocked(change.requestId)).length;

  let label = readyCount === 1 ? "Submit 1 change" : `Submit ${readyCount} changes`;
  if (!state.authReady) label = "Checking sign-in…";
  else if (!state.user) label = "Sign in to submit";
  else if (!state.operatorAuthorized) label = "Operator approval required";
  else if (busy) label = "Submitting…";
  else if (retry) label = "Retry submission";
  else if (!readyCount) label = "Nothing new to submit";

  elements.submitFirebaseLabel.textContent = label;
  elements.submitFirebaseButton.disabled = !state.authReady
    || !state.user
    || !state.operatorAuthorized
    || busy
    || (!retry && !readyCount);
}

function renderSubmissionStatus() {
  const readyCount = state.changes.filter((change) => !isRequestLocked(change.requestId)).length;
  const lockedCount = state.changes.length - readyCount;
  const submissions = state.submissions.slice(0, 6);
  elements.submissionStatus.hidden = !state.changes.length && !submissions.length;
  if (elements.submissionStatus.hidden) {
    elements.submissionStatus.replaceChildren();
    return;
  }

  const summary = document.createElement("p");
  summary.className = "submission-status__summary";
  const parts = [];
  if (readyCount) parts.push(`${readyCount} change${readyCount === 1 ? "" : "s"} ready to submit`);
  if (lockedCount) parts.push(`${lockedCount} awaiting deployment confirmation`);
  if (!parts.length) parts.push("No unsent changes in this browser");
  summary.textContent = parts.join(" · ");

  const list = document.createElement("div");
  list.className = "submission-status__list";
  submissions.forEach((submission) => {
    const item = document.createElement("div");
    item.className = "submission-status__item";
    if (submission.error) item.title = submission.error;

    const detail = document.createElement("span");
    const count = submission.requestIds.length;
    detail.textContent = `${submission.submissionId.slice(0, 8)} · ${count} change${count === 1 ? "" : "s"} · ${formatSubmissionTime(submission.submittedAt)}`;

    const badge = document.createElement("span");
    badge.className = `request-status request-status--${submission.status}`;
    badge.textContent = submissionStatusLabel(submission.status);
    item.append(detail, badge);
    list.append(item);
  });

  elements.submissionStatus.replaceChildren(summary, list);
}

function submissionStatusLabel(status) {
  return ({
    submitting: "Sending",
    pending: "Pending",
    processing: "Processing",
    applied: "Applied",
    failed: "Failed",
    retry: "Retry needed",
  })[status] || "Unknown";
}

function formatSubmissionTime(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return new Intl.DateTimeFormat("en-MY", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(date);
}

function renderChanges() {
  const cards = state.changes.map((change) => {
    const card = document.createElement("article");
    card.className = "change-card";
    const status = requestStatus(change.requestId);
    const locked = Boolean(status);
    if (locked) card.classList.add("change-card--submitted");

    const top = document.createElement("div");
    top.className = "change-card__top";
    const badges = document.createElement("div");
    badges.className = "change-card__badges";
    badges.append(createBadge(change.action, `change-badge--${change.action}`));
    badges.append(createBadge(change.type));
    if (status) badges.append(createBadge(status, `request-status request-status--${status}`));
    top.append(badges);

    const heading = document.createElement("h3");
    heading.textContent = change.title;

    const meta = document.createElement("p");
    meta.className = "change-card__meta";
    meta.textContent = changeSummary(change);

    card.append(top, heading, meta);

    if (change.details) {
      const details = document.createElement("p");
      details.className = "change-card__details";
      details.textContent = change.details;
      card.append(details);
    }

    const actions = document.createElement("div");
    actions.className = "change-card__actions";
    actions.append(
      cardAction("Edit", () => editChange(change.requestId), "", locked),
      cardAction("Duplicate", () => duplicateChange(change.requestId)),
      cardAction("Delete", () => deleteChange(change.requestId), "danger", locked),
    );
    card.append(actions);
    return card;
  });

  elements.changeList.replaceChildren(...cards);
}

function createBadge(label, modifier = "") {
  const badge = document.createElement("span");
  badge.className = `change-badge ${modifier}`.trim();
  badge.textContent = label.replaceAll("-", " ");
  return badge;
}

function cardAction(label, handler, className = "", disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.disabled = disabled;
  if (disabled) button.title = "Submitted changes stay locked until deployment is confirmed.";
  button.addEventListener("click", handler);
  return button;
}

function changeSummary(change) {
  const parts = [];
  if (change.date) {
    let date = formatDate(change.date);
    if (change.endDate && change.endDate !== change.date) date += `–${formatDate(change.endDate)}`;
    if (change.startTime) date += ` · ${formatTime(change.startTime)}`;
    if (change.endTime) date += `–${formatTime(change.endTime)}`;
    parts.push(date);
  } else {
    parts.push("Date to be arranged");
  }
  if (change.deadline) parts.push(`Due ${formatDate(change.deadline)}`);
  if (change.person) parts.push(change.person);
  if (change.recurrence?.frequency && change.recurrence.frequency !== "none") {
    parts.push(formatRecurrence(change.recurrence));
  }
  return parts.join(" · ");
}

function editChange(requestId) {
  const change = state.changes.find((item) => item.requestId === requestId);
  if (!change) return;
  if (isRequestLocked(requestId)) {
    showToast("This submitted change is locked until processing finishes", true);
    return;
  }

  state.editingId = requestId;
  setFormValue("action", change.action);
  setFormValue("type", change.type);
  setFormValue("title", change.title);
  setFormValue("existingEventId", change.existingEventId);
  setFormValue("date", change.date);
  setFormValue("endDate", change.endDate);
  setFormValue("startTime", change.startTime);
  setFormValue("endTime", change.endTime);
  setFormValue("deadline", change.deadline);
  setFormValue("priority", change.priority || "normal");
  setFormValue("recurrence", recurrenceValue(change.recurrence));
  setFormValue("repeatUntil", change.recurrence?.until);
  setFormValue("person", change.person);
  setFormValue("location", change.location);
  setFormValue("referenceUrl", change.referenceUrl);
  setFormValue("details", change.details);

  elements.formHeading.textContent = "Edit schedule change";
  elements.addChangeButton.lastChild.textContent = " Save this change";
  updateConditionalFields();
  saveDraft();
  elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
  document.querySelector("#title").focus({ preventScroll: true });
}

function duplicateChange(requestId) {
  const change = state.changes.find((item) => item.requestId === requestId);
  if (!change) return;
  state.changes.push({ ...structuredCloneSafe(change), requestId: createId(), title: `${change.title} (copy)` });
  state.updatedAt = new Date().toISOString();
  saveDraft();
  render();
  showToast("Change duplicated");
}

function deleteChange(requestId) {
  const change = state.changes.find((item) => item.requestId === requestId);
  if (change && isRequestLocked(requestId)) {
    showToast("This submitted change cannot be deleted before deployment is confirmed", true);
    return;
  }
  if (!change || !window.confirm(`Delete “${change.title}” from this update file?`)) return;
  state.changes = state.changes.filter((item) => item.requestId !== requestId);
  if (state.editingId === requestId) resetForm(false);
  state.updatedAt = new Date().toISOString();
  saveDraft();
  render();
  showToast("Change removed from the JSON file");
}

function resetForm(save = true) {
  elements.form.reset();
  state.editingId = null;
  elements.formHeading.textContent = "Add a schedule change";
  elements.addChangeButton.lastChild.textContent = " Add this change";
  clearFormError();
  updateConditionalFields();
  if (save) saveDraft();
}

function updatePreferences() {
  state.updatedAt = new Date().toISOString();
  saveDraft();
  renderPreview();
}

function buildExport(changes = state.changes) {
  return {
    $schema: "https://itlegend-co.github.io/scheduling-system/schedule-update.schema.json",
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    timezone: "Asia/Kuala_Lumpur",
    instructions: {
      mode: "changes-only",
      preserveUnmentionedEvents: true,
      autoScheduleMissingTimes: elements.autoSchedule.checked,
      createDeadlineWhenMissing: elements.createDeadline.checked,
    },
    note: elements.requestNote.value.trim(),
    changes: changes.map(cleanChange),
  };
}

function cleanChange(change) {
  const cleaned = {
    requestId: change.requestId,
    action: change.action,
    type: change.type,
    title: change.title,
    existingEventId: change.existingEventId,
    date: change.date,
    endDate: change.endDate,
    startTime: change.startTime,
    endTime: change.endTime,
    deadline: change.deadline,
    priority: change.priority,
    recurrence: change.recurrence?.frequency === "none"
      ? { frequency: "none" }
      : change.recurrence,
    person: change.person,
    location: change.location,
    referenceUrl: change.referenceUrl,
    details: change.details,
  };
  return removeEmpty(cleaned);
}

function renderPreview() {
  elements.jsonPreview.textContent = JSON.stringify(removeEmpty(buildExport()), null, 2);
}

function downloadJson() {
  if (!ensureChanges()) return;
  state.updatedAt = new Date().toISOString();
  const content = JSON.stringify(removeEmpty(buildExport()), null, 2) + "\n";
  const filename = `schedule-update-${localDateKey(new Date())}.json`;
  downloadBlob(filename, content, "application/json;charset=utf-8");
  saveDraft();
  renderPreview();
  showToast("Backup JSON downloaded · the local draft was kept");
}

async function copyJson() {
  if (!ensureChanges()) return;
  state.updatedAt = new Date().toISOString();
  const content = JSON.stringify(removeEmpty(buildExport()), null, 2);
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = content;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  saveDraft();
  renderPreview();
  showToast("JSON copied as a backup · the local draft was kept");
}

async function importJson(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;

  try {
    const imported = JSON.parse(await file.text());
    if (imported.format !== FORMAT_NAME || Number(imported.version) !== FORMAT_VERSION || !Array.isArray(imported.changes)) {
      throw new Error("This is not a supported Smart Schedule update file.");
    }
    if (state.changes.length && !window.confirm("Replace the current draft with the imported JSON file?")) return;

    state.changes = imported.changes.map(normalizeImportedChange);
    state.editingId = null;
    stopSubmissionWatchers();
    state.submissions = [];
    state.createdAt = imported.createdAt || new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    elements.autoSchedule.checked = imported.instructions?.autoScheduleMissingTimes !== false;
    elements.createDeadline.checked = imported.instructions?.createDeadlineWhenMissing !== false;
    elements.requestNote.value = imported.note || "";
    resetForm(false);
    saveDraft();
    render();
    showToast(`${state.changes.length} change${state.changes.length === 1 ? "" : "s"} imported`);
  } catch (error) {
    showToast(error.message || "Unable to import this JSON file", true);
  }
}

function normalizeImportedChange(change) {
  const recurrence = change.recurrence || { frequency: "none", interval: 1, until: "" };
  return {
    requestId: change.requestId || createId(),
    action: change.action || "add",
    type: change.type || "task",
    title: String(change.title || "Untitled change"),
    existingEventId: change.existingEventId || "",
    date: change.date || "",
    endDate: change.endDate || "",
    startTime: change.startTime || "",
    endTime: change.endTime || "",
    deadline: change.deadline || "",
    priority: change.priority || "normal",
    recurrence: {
      frequency: recurrence.frequency || "none",
      interval: Number(recurrence.interval) || 1,
      until: recurrence.until || "",
    },
    person: change.person || "",
    location: change.location || "",
    referenceUrl: change.referenceUrl || "",
    details: change.details || "",
  };
}

function normalizeSubmission(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(value.submissionId || "")) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value.ownerUid || "")) return null;
  if (!Array.isArray(value.requestIds) || !value.requestIds.length) return null;
  if (value.requestIds.some((id) => !/^[A-Za-z0-9_-]{1,180}$/.test(id || ""))) return null;

  const allowed = new Set(["submitting", "pending", "processing", "applied", "failed", "retry"]);
  let status = allowed.has(value.status) ? value.status : "retry";
  if (status === "submitting") status = "retry";
  if (status === "retry" && (!value.payload || typeof value.payload !== "object")) status = "failed";

  return {
    submissionId: value.submissionId,
    ownerUid: value.ownerUid,
    requestIds: [...new Set(value.requestIds)],
    submittedAt: value.submittedAt || new Date().toISOString(),
    status,
    payload: value.payload,
    error: String(value.error || ""),
    appliedAt: Number(value.appliedAt || 0),
    appliedCommit: String(value.appliedCommit || ""),
  };
}

function clearDraft() {
  const hasActiveSubmission = state.submissions.some((submission) => ACTIVE_SUBMISSION_STATUSES.has(submission.status));
  const warning = hasActiveSubmission
    ? "Some changes are still submitted. Clear the local copy anyway? Firebase processing will continue."
    : "Clear all changes and remove the locally saved draft?";
  if (!window.confirm(warning)) return;
  stopSubmissionWatchers();
  localStorage.removeItem(STORAGE_KEY);
  state.changes = [];
  state.editingId = null;
  state.createdAt = new Date().toISOString();
  state.updatedAt = state.createdAt;
  state.submissions = [];
  elements.autoSchedule.checked = true;
  elements.createDeadline.checked = true;
  elements.requestNote.value = "";
  resetForm(false);
  render();
  showToast("Draft cleared");
}

function saveDraft() {
  const draft = {
    changes: state.changes,
    editingId: state.editingId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    submissions: state.submissions.slice(0, 12),
    autoSchedule: elements.autoSchedule.checked,
    createDeadline: elements.createDeadline.checked,
    requestNote: elements.requestNote.value,
    form: Object.fromEntries(new FormData(elements.form).entries()),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    elements.draftStatus.lastChild.textContent = " Draft saved locally";
  } catch {
    elements.draftStatus.lastChild.textContent = " Draft could not be saved";
  }
}

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!draft) return;
    state.changes = Array.isArray(draft.changes) ? draft.changes.map(normalizeImportedChange) : [];
    state.editingId = draft.editingId || null;
    state.createdAt = draft.createdAt || state.createdAt;
    state.updatedAt = draft.updatedAt || state.updatedAt;
    state.submissions = Array.isArray(draft.submissions) ? draft.submissions.map(normalizeSubmission).filter(Boolean) : [];
    elements.autoSchedule.checked = draft.autoSchedule !== false;
    elements.createDeadline.checked = draft.createDeadline !== false;
    elements.requestNote.value = draft.requestNote || "";
    if (draft.form) {
      Object.entries(draft.form).forEach(([name, value]) => setFormValue(name, value));
    }
    if (state.editingId) {
      elements.formHeading.textContent = "Edit schedule change";
      elements.addChangeButton.lastChild.textContent = " Save this change";
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function ensureChanges() {
  if (state.changes.length) return true;
  showToast("Add at least one change first", true);
  document.querySelector("#title").focus();
  return false;
}

function showFormError(message, fieldId) {
  elements.formMessage.textContent = message;
  elements.formMessage.hidden = false;
  const field = document.querySelector(`#${fieldId}`);
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
  }
}

function friendlyFirebaseError(error) {
  const code = String(error?.code || "").replace(/^functions\//, "");
  const messages = {
    "unauthenticated": "Sign in with Google first.",
    "permission-denied": "This Google account is not approved for schedule submissions.",
    "not-found": "The secure submission function has not been deployed yet.",
    "unavailable": "Firebase is temporarily unavailable.",
    "deadline-exceeded": "Firebase did not respond in time.",
    "already-exists": "This request ID is already attached to different content.",
    "invalid-argument": error?.message || "Firebase rejected an invalid update request.",
    "auth/network-request-failed": "Google sign-in could not reach Firebase.",
    "auth/unauthorized-domain": "This website domain is not authorized in Firebase Authentication.",
  };
  return messages[code] || error?.message || "The secure Firebase request failed.";
}

function clearFormError() {
  elements.formMessage.hidden = true;
  elements.formMessage.textContent = "";
  elements.form.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute("aria-invalid"));
}

function parseRecurrence(value) {
  if (!value || value === "none") return { frequency: "none", interval: 1 };
  const [frequency, interval] = String(value).split(":");
  return { frequency, interval: Number(interval) || 1 };
}

function recurrenceValue(recurrence) {
  if (!recurrence || recurrence.frequency === "none") return "none";
  return `${recurrence.frequency}:${Number(recurrence.interval) || 1}`;
}

function formatRecurrence(recurrence) {
  const interval = Number(recurrence.interval) || 1;
  const units = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };
  const unit = units[recurrence.frequency] || recurrence.frequency;
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

function setFormValue(name, value = "") {
  const field = elements.form.elements.namedItem(name);
  if (field) field.value = value || "";
}

function value(formData, name) {
  return String(formData.get(name) || "").trim();
}

function removeEmpty(value) {
  if (Array.isArray(value)) return value.map(removeEmpty);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, removeEmpty(item)])
    .filter(([, item]) => item !== "" && item !== null && item !== undefined && !(typeof item === "object" && !Array.isArray(item) && !Object.keys(item).length)));
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function formatDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  const date = new Date(2000, 0, 1, hour, minute);
  return new Intl.DateTimeFormat("en-MY", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

function formatProfileTimestamp(value) {
  if (!value) return "date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(date);
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function downloadBlob(filename, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.style.background = isError ? "var(--rose)" : "var(--mint)";
  elements.toast.classList.add("toast--visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("toast--visible"), 2600);
}
