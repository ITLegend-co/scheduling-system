const STORAGE_KEY = "smart-schedule-update-draft-v1";
const FORMAT_NAME = "smart-schedule-update";
const FORMAT_VERSION = 1;

const state = {
  changes: [],
  editingId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
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
  clearDraftButton: document.querySelector("#clearDraftButton"),
  draftStatus: document.querySelector("#draftStatus"),
  toast: document.querySelector("#toast"),
};

loadDraft();
bindEvents();
updateConditionalFields();
render();

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
  elements.clearDraftButton.addEventListener("click", clearDraft);
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

  if (state.editingId) {
    const index = state.changes.findIndex((item) => item.requestId === state.editingId);
    if (index !== -1) state.changes[index] = { ...change, requestId: state.editingId };
    showToast("Change updated");
  } else {
    state.changes.push(change);
    showToast("Change added to the JSON file");
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
  if ((change.startTime || change.endTime) && !change.date) {
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
      new URL(change.referenceUrl);
    } catch {
      return { message: "Enter a complete reference link beginning with http:// or https://.", field: "referenceUrl" };
    }
  }
  return null;
}

function updateConditionalFields() {
  elements.existingIdField.hidden = elements.action.value === "add";
  elements.repeatUntilField.hidden = elements.recurrence.value === "none";
}

function render() {
  renderChanges();
  renderPreview();
  elements.changeCount.textContent = String(state.changes.length);
  elements.queueEmpty.hidden = state.changes.length > 0;
  elements.changeList.hidden = state.changes.length === 0;
}

function renderChanges() {
  const cards = state.changes.map((change) => {
    const card = document.createElement("article");
    card.className = "change-card";

    const top = document.createElement("div");
    top.className = "change-card__top";
    const badges = document.createElement("div");
    badges.className = "change-card__badges";
    badges.append(createBadge(change.action, `change-badge--${change.action}`));
    badges.append(createBadge(change.type));
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
      cardAction("Edit", () => editChange(change.requestId)),
      cardAction("Duplicate", () => duplicateChange(change.requestId)),
      cardAction("Delete", () => deleteChange(change.requestId), "danger"),
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

function cardAction(label, handler, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
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

function buildExport() {
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
    changes: state.changes.map(cleanChange),
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
  saveDraft();
  const content = JSON.stringify(removeEmpty(buildExport()), null, 2) + "\n";
  const filename = `schedule-update-${localDateKey(new Date())}.json`;
  downloadBlob(filename, content, "application/json;charset=utf-8");
  renderPreview();
  showToast("JSON update file downloaded");
}

async function copyJson() {
  if (!ensureChanges()) return;
  state.updatedAt = new Date().toISOString();
  saveDraft();
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
  renderPreview();
  showToast("JSON copied");
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

function clearDraft() {
  if (!window.confirm("Clear all changes and remove the locally saved draft?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.changes = [];
  state.editingId = null;
  state.createdAt = new Date().toISOString();
  state.updatedAt = state.createdAt;
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
  return `change-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
