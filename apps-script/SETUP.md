# Setting up the Google Sheet + Apps Script backend

One-time setup to stand up the backend this site talks to.

1. **Create the Sheet.** Make a new Google Sheet (any name, e.g. "SSP Rota data"). You don't need to add any tabs by hand — the script creates `People`, `Availability`, `DutyDays`, `Assignments` and `Changelog` the first time each is used.

2. **Attach the script.** In the Sheet, go to **Extensions → Apps Script**. Delete the default `Code.gs` contents and paste in the whole of [`ssp-rota.gs.txt`](./ssp-rota.gs.txt) from this repo.

3. **Set Script Properties** (Project Settings, gear icon → Script Properties → Add script property):

   | Key | Value |
   |---|---|
   | `ADMIN_EMAILS` | Comma-separated Google account emails allowed to sign in as admin, e.g. `jane@gmail.com,dave@gmail.com` |
   | `GOOGLE_CLIENT_ID` | Must match `index.html`'s `GOOGLE_CLIENT_ID` exactly — the backend rejects any Google token not issued to this client. This repo's `index.html` ships with the same shared client ID the leaflet-map deployments use (`580224381168-i67a13m72bvlpq8rtkhnjk15tic4k9e1.apps.googleusercontent.com`) — reusable here because an OAuth "authorised origin" is scheme+host only (`https://daemeous.github.io`), not path, so it already covers any repo served from that same GitHub Pages account. Only get your own from the [Google Cloud Console credentials page](https://console.cloud.google.com/apis/credentials) if you want a separate client (e.g. a different GitHub Pages account). |

   Leave `ADMIN_EMAILS` blank if you're only using the shared password to sign in — Google sign-in and the shared password are independent, either gets you in.

4. **Set the shared admin password — from the Sheet itself, not the script editor.** `setPasswordFromPrompt` needs to open a dialog box, which only works when it's triggered from inside the actual Google Sheet's menu bar — running it (or `onOpen`) via the Apps Script editor's "Run" button always fails with `Cannot call SpreadsheetApp.getUi() from this context`, since the editor has no Sheet UI to attach a dialog to. Don't try to run anything from the editor for this step.

   1. Switch to the actual Google Sheet tab in your browser (not the script editor) and reload the page. `onOpen` fires automatically on open — you'll see a new **"SSP Rota"** menu appear in the menu bar, next to Help.
   2. Click **SSP Rota → Set admin password**. The very first time you use it, Google will likely interrupt with an **"Authorization required"** popup (the script needs permission to read/write this Sheet) — click through it and allow access, then click the menu item again.
   3. A dialog box asks for the new password; type it there.

   The password itself is never written to any file — only a salted hash is stored in the script's own Properties. Repeat step 4.2–4.3 any time you want to change the password.

5. **Deploy as a web app.** Deploy → New deployment → type: **Web app**. Execute as **Me**, who has access: **Anyone**. Copy the resulting web app URL — this is `APPS_SCRIPT_URL` in `index.html`'s config block.

6. **Fill in `index.html`'s config block** at the top of the file:

   ```js
   window.SSP_CONFIG = {
     APPS_SCRIPT_URL: "https://script.google.com/macros/s/XXXXX/exec",
     GOOGLE_CLIENT_ID: "XXXXX.apps.googleusercontent.com", // optional if password-only
   };
   ```

7. **Add people.** Once the site is live and you're signed in, use the People tab to add everyone with their gender, and whether they're a qualified leader and/or driver — the rota generator needs at least one of each per duty night and can't schedule around people it doesn't know about.

## Redeploying after editing the script

Apps Script web app URLs stay stable across edits **only if** you use "Manage deployments → Edit → New version" rather than creating a brand new deployment each time. If you ever do end up with a new URL, update it in `index.html` and push.

## Bank holiday lookup

`getDefaultDutyDays` calls the UK government's public bank holidays API (`https://www.gov.uk/bank-holidays.json`, England & Wales) to suggest the Sunday before a bank holiday Monday. It's cached for 6 hours per Apps Script execution context, and fails soft (just no bank-holiday Sundays get suggested) if that request ever fails — it never blocks the rest of the calendar from loading.
