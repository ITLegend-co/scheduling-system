# Smart Schedule

A responsive schedule website designed for a simple ChatGPT-to-GitHub workflow. Build a changes-only JSON request, send it to ChatGPT, let it arrange suitable free slots, and commit the updated schedule. GitHub Pages then publishes the website and a subscribable calendar feed.

## What is included

- Responsive monthly calendar and upcoming agenda
- Search and category filters
- Event details with Google Calendar, Outlook, and `.ics` options
- Public `schedule.ics` feed for automatic calendar subscription updates
- Installable Progressive Web App for Android and iPhone home screens
- Offline app-shell and last-saved schedule access
- Form-based Schedule Update Builder with the current master profile, local draft saving, and JSON import/export
- A changes-only JSON format that protects unmentioned schedule events
- Schedule validation with duplicate-ID, date, and overlap checks
- Firebase Realtime Database delivery with public read-only access and automatic GitHub synchronization
- GitHub Pages deployment on every commit to `main`
- A reusable JSON Schema and ChatGPT update instructions

## Publish the website

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Open the **Actions** tab and run **Validate and deploy schedule** if it did not start automatically.
4. The website will be available at:

   `https://itlegend-co.github.io/scheduling-system/`

## Update the schedule through ChatGPT

1. Open the [Schedule Update Builder](https://itlegend-co.github.io/scheduling-system/update.html) to view the master profile converted from `help update schedule.txt`.
2. Select **Create update** on a current item, or add a new, completed, or removed item, then download the changes-only JSON file.
3. Attach the JSON file to ChatGPT and select the GitHub connector.
4. Ask ChatGPT to update `ITLegend-co/scheduling-system` directly.
5. ChatGPT should follow [`CHATGPT_WORKFLOW.txt`](CHATGPT_WORKFLOW.txt), update [`data/schedule.json`](data/schedule.json), validate it, and commit to `main`.
6. GitHub Actions redeploys the website automatically.

The current plan is stored in [`data/schedule-profile.json`](data/schedule-profile.json) and documented by [`schedule-profile.schema.json`](schedule-profile.schema.json). The changes-only export is documented by [`schedule-update.schema.json`](schedule-update.schema.json). Plain-text requests remain supported as a fallback.

## Install on a smartphone

Open `https://itlegend-co.github.io/scheduling-system/` on the phone while online at least once.

- **Android:** Select **Install app** in Smart Schedule or use the browser menu → **Install app**.
- **iPhone/iPad:** Open the site in Safari, select **Share** → **Add to Home Screen** → **Add**.

The installed app opens the calendar in standalone mode. The calendar and Update Builder app shell are cached for offline access, while schedule and profile data use the latest online copy when available and fall back to the last cached copy when offline.

## Firebase synchronization

The published calendar reads `smartSchedule/schedule` from the Firebase Realtime Database project `schedule-d2ce8` and listens for live changes. The Update Builder reads `smartSchedule/profile`. If Firebase is unavailable, both pages fall back to the versioned JSON files bundled with the PWA.

Every successful push to `main` validates the schedule, then the GitHub Actions workflow uses the repository secret `FIREBASE_SERVICE_ACCOUNT_SCHEDULE_D2CE8` to:

1. Deploy read-only public rules for the schedule and profile paths.
2. Synchronize `data/schedule.json` and `data/schedule-profile.json` to Firebase.
3. Record the source commit and synchronization timestamp.

The private service-account JSON must remain only in GitHub Actions Secrets. Never commit it to the repository or place it in browser code.

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
node scripts/validate-schedule.mjs
node scripts/validate-pwa.mjs
node scripts/generate-ics.mjs
python -m http.server 8000
```

Then open `http://localhost:8000`.
