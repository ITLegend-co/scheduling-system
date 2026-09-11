import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

const DATABASE_URL = "https://schedule-d2ce8-default-rtdb.asia-southeast1.firebasedatabase.app";
const PROJECT_ID = "schedule-d2ce8";
const SECRET_NAME = "FIREBASE_SERVICE_ACCOUNT_SCHEDULE_D2CE8";

export function openFirebaseAdmin() {
  const secret = process.env[SECRET_NAME];
  if (!secret) throw new Error(`GitHub secret ${SECRET_NAME} is missing.`);

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(secret);
  } catch {
    throw new Error(`${SECRET_NAME} is not valid JSON.`);
  }

  if (serviceAccount.project_id !== PROJECT_ID) {
    throw new Error(`The Firebase service account belongs to ${serviceAccount.project_id || "an unknown project"}, not ${PROJECT_ID}.`);
  }

  const app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: DATABASE_URL,
  });

  return {
    auth: getAuth(app),
    database: getDatabase(app),
    close: () => deleteApp(app),
  };
}
