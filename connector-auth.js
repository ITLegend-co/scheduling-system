const CONNECTOR_URL = "https://schedule-d2ce8.web.app";
const authorizationRequestId = new URLSearchParams(location.search).get("request") || "";
const elements = {
  accountPanel: document.querySelector("#accountPanel"),
  accountHeading: document.querySelector("#accountHeading"),
  accountStatus: document.querySelector("#accountStatus"),
  signInButton: document.querySelector("#signInButton"),
  approveButton: document.querySelector("#approveButton"),
  denyButton: document.querySelector("#denyButton"),
  error: document.querySelector("#connectorError"),
};

let firebase;
let user = null;
let authorized = false;
let busy = false;

elements.signInButton.addEventListener("click", toggleSignIn);
elements.approveButton.addEventListener("click", approveAccess);
elements.denyButton.addEventListener("click", denyAccess);
initialize();

async function initialize() {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(authorizationRequestId)) {
    showError("This connector request is missing or invalid. Start the connection again from ChatGPT or Codex.");
    elements.signInButton.disabled = true;
    elements.denyButton.disabled = true;
    return;
  }

  try {
    firebase = await import("./firebase-client.js");
    firebase.watchAuth(handleAuthState, (error) => showError(error.message || "Google sign-in could not be checked."));
  } catch (error) {
    showError(error.message || "Firebase could not be loaded.");
  }
}

async function handleAuthState(nextUser) {
  user = nextUser;
  authorized = false;
  elements.accountPanel.classList.remove("connector-account--error");

  if (!user) {
    elements.accountHeading.textContent = "Sign in to continue";
    elements.accountStatus.textContent = "Use the same approved Google account as the Schedule Update Builder.";
    elements.signInButton.textContent = "Sign in with Google";
    elements.signInButton.disabled = false;
    updateButtons();
    return;
  }

  elements.accountHeading.textContent = `Signed in as ${user.displayName || user.email || "Google user"}`;
  elements.accountStatus.textContent = "Checking schedule operator access…";
  elements.signInButton.textContent = "Sign out";
  elements.signInButton.disabled = false;
  updateButtons();

  try {
    const result = await firebase.getScheduleOperatorStatus();
    if (user?.uid !== nextUser.uid) return;
    authorized = result.authorized === true;
    if (authorized) {
      elements.accountHeading.textContent = `Ready as ${user.displayName || user.email || "schedule operator"}`;
      elements.accountStatus.textContent = "This account may approve the requested connector permissions.";
    } else {
      elements.accountPanel.classList.add("connector-account--error");
      elements.accountHeading.textContent = "Operator approval needed";
      elements.accountStatus.textContent = `This account is not approved yet. Firebase UID: ${result.uid || user.uid}`;
    }
  } catch (error) {
    elements.accountPanel.classList.add("connector-account--error");
    elements.accountHeading.textContent = "Could not verify operator access";
    elements.accountStatus.textContent = error.message || "Try again after the Firebase functions are deployed.";
  }
  updateButtons();
}

async function toggleSignIn() {
  clearError();
  setBusy(true);
  try {
    if (user) await firebase.signOutUser();
    else await firebase.signInWithGoogle();
  } catch (error) {
    if (error?.code !== "auth/popup-closed-by-user") showError(error.message || "Google sign-in failed.");
  } finally {
    setBusy(false);
  }
}

async function approveAccess() {
  if (!user || !authorized || busy) return;
  clearError();
  setBusy(true);
  try {
    const idToken = await user.getIdToken(true);
    const result = await connectorPost("/oauth/approve", { authorizationRequestId, idToken });
    location.assign(result.redirectUrl);
  } catch (error) {
    showError(error.message || "Access could not be approved.");
    setBusy(false);
  }
}

async function denyAccess() {
  if (busy) return;
  clearError();
  setBusy(true);
  try {
    const result = await connectorPost("/oauth/deny", { authorizationRequestId });
    location.assign(result.redirectUrl);
  } catch (error) {
    showError(error.message || "The connector request could not be cancelled.");
    setBusy(false);
  }
}

async function connectorPost(path, body) {
  const response = await fetch(`${CONNECTOR_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error_description || "The secure connector returned an error.");
  return result;
}

function setBusy(value) {
  busy = value;
  updateButtons();
}

function updateButtons() {
  elements.signInButton.disabled = busy || !firebase;
  elements.approveButton.disabled = busy || !user || !authorized;
  elements.denyButton.disabled = busy;
  elements.approveButton.textContent = busy ? "Please wait…" : "Allow access";
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function clearError() {
  elements.error.textContent = "";
  elements.error.hidden = true;
}
