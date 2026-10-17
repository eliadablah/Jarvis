# Job tracker connection

The dashboard's Job search section shows my real pipeline, read live from the
Google Sheets tracker. It is read-only: the PC worker and my 6 AM routine write
to the sheet; the server only reads it.

## How it works

- The server signs in to Google as a **service account** (a robot user) that I
  shared the sheet with as **Viewer**. It can read that one sheet and nothing
  else, and uses the `spreadsheets.readonly` scope.
- No new dependencies: the sign-in JWT is signed with `node:crypto`, and the
  Sheets REST API is called with `fetch` (`app/src/jobs/tracker.ts`).
- `GET /api/jobs` returns the summary (applied, need me, responses, last 7
  days) and up to 60 recent applications. Results are cached for a minute; if
  Google is briefly down, a saved copy is served for up to ten minutes.
- Columns are found by header name. The `CV Used` and `Notes` columns are never
  sent to the browser, and only `https://` posting links are kept.
- Without the key or sheet ID the section keeps showing "Tracker not
  connected", so the app works without this.

## Setup (once)

1. In Google Cloud Console, create a project, enable the **Google Sheets API**,
   and create a **service account** with no roles. Add a **JSON key** to it.
2. Share the tracker sheet with the service account's email
   (`...@...iam.gserviceaccount.com`) as **Viewer**.
3. Store the key as the GitHub secret `GOOGLE_SERVICE_ACCOUNT_B64` (the JSON,
   base64-encoded, so it fits on one line in the server's `.env`):

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\Downloads\<key>.json")) | gh secret set GOOGLE_SERVICE_ACCOUNT_B64 --repo eliadablah/Jarvis
   ```

4. Delete the downloaded JSON file, then re-run the latest **Deploy** workflow.

The sheet ID is set in `deploy/compose.yaml` (`JOB_TRACKER_SHEET_ID`); it is not
a secret on its own. Set `JOB_TRACKER_RANGE` to change the default `A1:L1000`
(first tab).

## Rotating or removing access

Delete the service account key in Google Cloud (or un-share the sheet) and
clear the GitHub secret. The dashboard falls back to "Tracker not connected".
