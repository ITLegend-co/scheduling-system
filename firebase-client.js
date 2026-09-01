import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  get,
  getDatabase,
  onValue,
  ref,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

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
const database = getDatabase(app);
const paths = {
  schedule: "smartSchedule/schedule",
  profile: "smartSchedule/profile",
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

async function readRequired(path, isValid, label) {
  const snapshot = await get(ref(database, path));
  if (!snapshot.exists()) throw new Error(`Firebase does not contain a ${label} yet.`);
  const value = snapshot.val();
  if (!isValid(value)) throw new Error(`Firebase returned an invalid ${label}.`);
  return value;
}

function watchRequired(path, isValid, onData, onError) {
  return onValue(
    ref(database, path),
    (snapshot) => {
      if (!snapshot.exists()) return;
      const value = snapshot.val();
      if (isValid(value)) onData(value);
    },
    onError,
  );
}
