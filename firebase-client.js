import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  get,
  getDatabase,
  onValue,
  ref,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyBh54Rf1LfxpLTIpaqRBbVCbk-98yu3QCY",
  authDomain: "schedule-d2ce8.firebaseapp.com",
  databaseURL: "https://schedule-d2ce8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "schedule-d2ce8",
  storageBucket: "schedule-d2ce8.firebasestorage.app",
  messagingSenderId: "174604693807",
  appId: "1:174604693807:web:b5612519da93c27e6231da",
  measurementId: "G-YZ0E6BFN96",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const functions = getFunctions(app, "asia-southeast1");
const authReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Firebase Auth persistence could not be enabled.", error);
});
const paths = {
  schedule: "smartSchedule/schedule",
  profile: "smartSchedule/profile",
  updateRequests: "smartSchedule/updateRequests",
};

export async function readSchedule() {
  return readRequired(paths.schedule, (value) => Array.isArray(value?.events), "schedule");
}

export async function readProfile() {
  return readRequired(
    paths.profile,
    (value) => value?.format === "smart-schedule-profile" && Number(value?.version) === 1 && Array.isArray(value?.entries),
    "schedule profile",
  );
}

export function watchSchedule(onData, onError) {
  return watchRequired(paths.schedule, (value) => Array.isArray(value?.events), onData, onError);
}

export function watchProfile(onData, onError) {
  return watchRequired(
    paths.profile,
    (value) => value?.format === "smart-schedule-profile" && Number(value?.version) === 1 && Array.isArray(value?.entries),
    onData,
    onError,
  );
}

export function watchAuth(onUser, onError) {
  return onAuthStateChanged(auth, onUser, onError);
}

export async function signInWithGoogle() {
  await authReady;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    return await signInWithPopup(auth, provider);
  } catch (error) {
    if (new Set(["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"]).has(error?.code)) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
}

export async function signOutUser() {
  await signOut(auth);
}

export async function getScheduleOperatorStatus() {
  const call = httpsCallable(functions, "getScheduleOperatorStatus");
  const response = await call({});
  return response.data;
}

export async function submitScheduleUpdate(submissionId, payload) {
  const call = httpsCallable(functions, "submitScheduleUpdate", { timeout: 30_000 });
  const response = await call({ submissionId, payload });
  return response.data;
}

export function watchUpdateRequest(submissionId, onData, onError) {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(submissionId || "")) throw new Error("Invalid submission ID.");
  return onValue(
    ref(database, `${paths.updateRequests}/${submissionId}`),
    (snapshot) => {
      if (snapshot.exists()) onData(restoreDocumentMetadata(snapshot.val()));
    },
    onError,
  );
}

async function readRequired(path, isValid, label) {
  const snapshot = await get(ref(database, path));
  if (!snapshot.exists()) throw new Error(`Firebase does not contain a ${label} yet.`);
  const value = restoreDocumentMetadata(snapshot.val());
  if (!isValid(value)) throw new Error(`Firebase returned an invalid ${label}.`);
  return value;
}

function watchRequired(path, isValid, onData, onError) {
  return onValue(
    ref(database, path),
    (snapshot) => {
      if (!snapshot.exists()) return;
      const value = restoreDocumentMetadata(snapshot.val());
      if (isValid(value)) onData(value);
    },
    onError,
  );
}

function restoreDocumentMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const restored = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreDocumentMetadata(item)]));
  if (!restored.schemaUrl || restored.$schema) return restored;
  const { schemaUrl, ...document } = restored;
  return { $schema: schemaUrl, ...document };
}
