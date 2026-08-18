import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = readJson("manifest.webmanifest");
const errors = [];

check(manifest.name === "Smart Schedule", "Manifest name must be Smart Schedule");
check(manifest.id === "./", "Manifest ID must remain inside the GitHub Pages project scope");
check(manifest.scope === "./", "Manifest scope must be relative to the project path");
check(String(manifest.start_url || "").startsWith("./"), "Manifest start_url must be relative to the project path");
check(manifest.display === "standalone", "Manifest display must be standalone");
check(manifest.theme_color === "#0b1220", "Manifest theme colour must match the website");

const requiredIcons = [
  ["icons/app-icon-192.png", 192, "any"],
  ["icons/app-icon-512.png", 512, "any"],
  ["icons/app-icon-maskable-512.png", 512, "maskable"],
];

for (const [path, size, purpose] of requiredIcons) {
  const icon = manifest.icons?.find((item) => item.src === path && item.sizes === `${size}x${size}` && item.purpose === purpose);
  check(Boolean(icon), `Manifest is missing ${path} as a ${purpose} icon`);
  if (!exists(path)) continue;
  const dimensions = pngDimensions(path);
  check(dimensions.width === size && dimensions.height === size, `${path} must be ${size}x${size}`);
}

check(exists("icons/apple-touch-icon.png"), "Apple touch icon is missing");
if (exists("icons/apple-touch-icon.png")) {
  const dimensions = pngDimensions("icons/apple-touch-icon.png");
  check(dimensions.width === 180 && dimensions.height === 180, "Apple touch icon must be 180x180");
}

for (const page of ["index.html", "update.html"]) {
  const html = readText(page);
  check(html.includes('rel="manifest" href="manifest.webmanifest"'), `${page} must link the manifest`);
  check(html.includes('rel="apple-touch-icon" href="icons/apple-touch-icon.png"'), `${page} must link the Apple touch icon`);
  check(html.includes('id="installAppButton"'), `${page} must include the install button`);
  check(html.includes('src="pwa.js"'), `${page} must load pwa.js`);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  check(!duplicates.length, `${page} has duplicate IDs: ${duplicates.join(", ")}`);
}

for (const path of ["pwa.js", "service-worker.js", "offline.html", "icons/app-icon.svg"]) {
  check(exists(path), `${path} is missing`);
}

const serviceWorker = readText("service-worker.js");
for (const path of [
  "./index.html",
  "./update.html",
  "./offline.html",
  "./styles.css",
  "./app.js",
  "./update.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./data/schedule.json",
  "./data/schedule-profile.json",
]) {
  check(serviceWorker.includes(`"${path}"`), `Service-worker app shell is missing ${path}`);
}

const workflow = readText(".github/workflows/deploy-pages.yml");
for (const asset of ["manifest.webmanifest", "service-worker.js", "pwa.js", "offline.html", "_site/icons"]) {
  check(workflow.includes(asset), `Deployment workflow does not publish ${asset}`);
}

if (errors.length) {
  console.error(`PWA validation failed (${errors.length}):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`PWA is valid: ${manifest.icons.length} manifest icon(s), ${manifest.shortcuts?.length || 0} shortcut(s), and 2 installable pages.`);

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function exists(path) {
  const present = existsSync(resolve(root, path));
  check(present, `${path} is missing`);
  return present;
}

function pngDimensions(path) {
  const buffer = readFileSync(resolve(root, path));
  if (buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    errors.push(`${path} is not a valid PNG file`);
    return { width: 0, height: 0 };
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function check(condition, message) {
  if (!condition) errors.push(message);
}
