import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(nativeRoot, "..");
const webRoot = resolve(nativeRoot, "www");
const files = [
  "index.html", "styles.css", "app.js", "firebase-client.js", "pwa.js",
  "service-worker.js", "offline.html", "manifest.webmanifest", "update.html",
  "update.css", "update.js", "schedule-update.schema.json",
  "schedule-profile.schema.json", "schedule.ics"
];

await rm(webRoot, { recursive: true, force: true });
await mkdir(webRoot, { recursive: true });
for (const file of files) await cp(resolve(repositoryRoot, file), resolve(webRoot, file));
await cp(resolve(repositoryRoot, "icons"), resolve(webRoot, "icons"), { recursive: true });
await cp(resolve(repositoryRoot, "data"), resolve(webRoot, "data"), { recursive: true });

const indexPath = resolve(webRoot, "index.html");
const html = await readFile(indexPath, "utf8");
const marker = "  </body>";
if (!html.includes(marker)) throw new Error("index.html does not contain a closing body tag.");
await writeFile(indexPath, html.replace(
  marker,
  '    <script type="module" src="native-notifications.js"></script>\n' + marker
), "utf8");

console.log("Prepared Smart Schedule web assets for Android.");
