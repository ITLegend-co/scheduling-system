# Smart Schedule

A responsive schedule website with a secure Firebase-to-ChatGPT update queue. Build a changes-only request, submit it with Google sign-in, and let ChatGPT arrange it against the current plan without uploading a JSON file. GitHub validates and deploys the result before the browser clears the submitted cards.

## What is included

- Responsive monthly calendar and upcoming agenda
- Search and category filters
- Event details with Google Calendar, Outlook, and `.ics` options
- Public `schedule.ics` feed for automatic calendar subscription updates
- Installable Progressive Web App for Android and iPhone home screens
- Offline app-shell and last-saved schedule access
- Form-based Schedule Update Builder with the current master profile, local draft saving, secure submission, and JSON backup import/export
- A changes-only JSON format that protects unmentioned schedule events
- Schedule validation with duplicate-ID, date, and overlap checks
- Authenticated Firebase request submission with exact request IDs and `pending → processing → applied` status
- OAuth-protected Smart Schedule connector for ChatGPT and Codex; the service-account key never enters browser code
- Firebase Realtime Database delivery with public read-only schedule data and owner-only request status reads
- GitHub Pages deployment on every commit to `main`
- Post-deployment confirmation that clears only the exact applied browser cards
- Reusable JSON Schemas and ChatGPT update instructions

## Publish the website

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Open the **Actions** tab and run **Validate and deploy schedule** if it did not start automatically.
4. The website will be available at:

   `https://itlegend-co.github.io/scheduling-system/`

## First-time secure setup

The Firebase functions deploy automatically after these files reach `main`. Then approve the Google account that is allowed to submit and claim requests:

1. Open the [Schedule Update Builder](https://itlegend-co.github.io/scheduling-system/update.html) and select **Sign in with Google**.
2. If the page says **Operator approval needed**, copy the Firebase UID it displays.
3. In GitHub, open **Actions → Manage schedule operator → Run workflow**.
4. Choose `grant`, paste the Firebase UID, and run the workflow.
5. Refresh the Update Builder. It should say **Ready as …**.

Use the same Google account when connecting ChatGPT or Codex. To revoke access later, run the same workflow with `revoke`.

## Secure ChatGPT connector

The remote MCP endpoint is:

`https://schedule-d2ce8.web.app/mcp`

It exposes four narrowly scoped tools: list pending requests, claim one request, check status, and release a claim. OAuth authorization happens on the GitHub Pages consent screen with Firebase Google sign-in. Tokens and pending payloads live only in protected Firebase paths; the browser configuration contains no service-account credential.

Normal update flow:

1. Open the [Schedule Update Builder](https://itlegend-co.github.io/scheduling-system/update.html), add only the changes you want, and select **Submit**.
2. The browser creates one idempotent submission and keeps those cards locked locally.
3. Tell ChatGPT: “Use my Smart Schedule connector and update `ITLegend-co/scheduling-system`.” No JSON attachment is needed.
4. ChatGPT claims the request with a unique UUID, follows [`CHATGPT_WORKFLOW.txt`](CHATGPT_WORKFLOW.txt), updates the schedule/profile and claim-bound release receipt, validates them, and commits to `main`.
5. GitHub Pages and Firebase must both deploy successfully. Only then does the confirmation job set the request to `applied`.
6. The Update Builder observes `applied` and removes only the matching request IDs. A failed build or deployment leaves the cards in place.

| Status | Meaning |
| --- | --- |
| `pending` | Stored securely and waiting for ChatGPT/Codex |
| `processing` | Claimed by one unique processing ID with an expiry lease, preventing duplicate work |
| `applied` | The matching GitHub commit was synchronized and deployed successfully |
| `failed` | Processing stopped; the local cards remain available for recovery |

**Copy JSON** and **Download backup** remain available if the connector is unavailable. A backup export never clears or marks the local draft as submitted.

The current plan is stored in [`data/schedule-profile.json`](data/schedule-profile.json) and documented by [`schedule-profile.schema.json`](schedule-profile.schema.json). The changes-only export is documented by [`schedule-update.schema.json`](schedule-update.schema.json). Plain-text requests remain supported as a fallback.

## Install on a smartphone

Open `https://itlegend-co.github.io/scheduling-system/` on the phone while online at least once.

- **Android:** Select **Install app** in Smart Schedule or use the browser menu → **Install app**.
- **iPhone/iPad:** Open the site in Safari, select **Share** → **Add to Home Screen** → **Add**.

The installed app opens the calendar in standalone mode. The calendar and Update Builder app shell are cached for offline access, while schedule and profile data use the latest online copy when available and fall back to the last cached copy when offline.

## Firebase synchronization

The published calendar reads `smartSchedule/schedule` from the Firebase Realtime Database project `schedule-d2ce8` and listens for live changes. The Update Builder reads `smartSchedule/profile`. If Firebase is unavailable, both pages fall back to the versioned JSON files bundled with the PWA.

Every successful push to `main` validates the schedule and update-request handling. The GitHub Actions workflow then uses the repository secret `FIREBASE_SERVICE_ACCOUNT_SCHEDULE_D2CE8` to:

1. Deploy read-only public rules for the schedule and profile paths.
2. Synchronize `data/schedule.json` and `data/schedule-profile.json` to Firebase.
3. Record the source commit and synchronization timestamp.
4. Deploy the GitHub Pages site.
5. Confirm every request listed in `data/update-release.json` only after both synchronization and Pages deployment succeed.

The private service-account JSON must remain only in GitHub Actions Secrets. Never commit it to the repository or place it in browser code.

Firebase Functions and the standards-compliant Firebase Hosting connector routes are deployed separately by **Deploy schedule request functions**. The callable submission functions and OAuth/MCP endpoint all validate authenticated operator access on the server.

## Subscribe your calendar

After the first deployment, subscribe to:

`https://itlegend-co.github.io/scheduling-system/schedule.ics`

- **Google Calendar:** Other calendars → From URL
- **Outlook:** Add calendar → Subscribe from web
- **Apple Calendar:** File → New Calendar Subscription

The subscription does not require an API key. Refresh timing is controlled by the calendar provider, so changes may not appear immediately. Individual events can also be added instantly from the website.

## Schedule data

The website reads [`data/schedule.json`](data/schedule.json). Timed events must use an ISO date-time with an explicit offset:

```json
{
  "id": "technical-meeting-2026-08-18",
  "title": "Technical Meeting",
  "start": "2026-08-18T14:30:00+08:00",
  "end": "2026-08-18T15:30:00+08:00",
  "allDay": false,
  "category": "Meeting",
  "priority": "high",
  "status": "confirmed",
  "location": "KK Office",
  "description": "Weekly technical discussion",
  "allowOverlap": false
}
```

Supported statuses: `planned`, `confirmed`, `tentative`, `completed`, `cancelled`.

Supported priorities: `low`, `normal`, `high`, `urgent`.

## Local checks

```bash
npm install --prefix functions --no-package-lock --ignore-scripts --no-audit --no-fund
node scripts/validate-schedule.mjs
node scripts/validate-profile.mjs
node scripts/test-update-requests.mjs
node scripts/test-connector.mjs
node scripts/validate-pwa.mjs
node --check functions/index.js
node --check functions/connector.js
node scripts/generate-ics.mjs data/schedule.json /tmp/schedule.ics
python -m http.server 8000
```

Then open `http://localhost:8000`.
