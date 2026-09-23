import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(nativeRoot, "android/app/src/main/AndroidManifest.xml");
let manifest = await readFile(manifestPath, "utf8");
const permissions = [
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />'
];

for (const permission of permissions) {
  if (!manifest.includes(permission)) {
    manifest = manifest.replace("<application", `    ${permission}\n\n    <application`);
  }
}
await writeFile(manifestPath, manifest, "utf8");

const drawable = resolve(nativeRoot, "android/app/src/main/res/drawable");
await mkdir(drawable, { recursive: true });
await writeFile(resolve(drawable, "ic_stat_schedule.xml"), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF"
        android:pathData="M7,2h2v2h6V2h2v2h1a3,3 0,0 1,3 3v12a3,3 0,0 1,-3 3H6a3,3 0,0 1,-3 -3V7a3,3 0,0 1,3 -3h1V2zM5,10v9a1,1 0,0 0,1 1h12a1,1 0,0 0,1 -1v-9H5zM9.2,14.6l1.7,1.7 3.9,-4 1.4,1.4 -5.3,5.4 -3.1,-3.1 1.4,-1.4z" />
</vector>
`, "utf8");

const iconSource = resolve(nativeRoot, "icon.png");
const resourceRoot = resolve(nativeRoot, "android/app/src/main/res");
const entries = await readdir(resourceRoot, { recursive: true, withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile() || !/^ic_launcher.*\.png$/.test(entry.name)) continue;
  await cp(iconSource, join(entry.parentPath || entry.path, entry.name));
}
console.log("Configured Android permissions and Smart Schedule icons.");
