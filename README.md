# Smart Schedule

A responsive schedule website designed for a simple ChatGPT-to-GitHub workflow. Build a changes-only JSON request, send it to ChatGPT, let it arrange suitable free slots, and commit the updated schedule. GitHub Pages then publishes the website and a subscribable calendar feed.

## What is included

- Responsive monthly calendar and upcoming agenda
- Search and category filters
- Event details with Google Calendar, Outlook, and `.ics` options
- Public `schedule.ics` feed for automatic calendar subscription updates
- Form-based Schedule Update Builder with the current master profile, local draft saving, and JSON import/export
- A changes-only JSON format that protects unmentioned schedule events
- Schedule validation with duplicate-ID, date, and overlap checks
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
node scripts/generate-ics.mjs
python -m http.server 8000
```

Then open `http://localhost:8000`.
