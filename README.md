# SSP Rota

A patrol duty rota scheduler: pick duty nights on a calendar, record everyone's availability, and generate several ranked, constraint-satisfying rota options — as both a list and a visual calendar, ready to paste into an email.

Static frontend (GitHub Pages) + a Google Sheet as the database, with a Google Apps Script web app as the only thing allowed to write to it — same pattern as [leaflet-map](https://github.com/Daemeous/leaflet-map).

## How it works

1. **People** — record each person's name, gender, and whether they're a qualified leader and/or driver.
2. **Duty Days** — a monthly calendar defaults to every Saturday, the final Friday, and the Sunday before any bank holiday Monday; click any date to add or remove it.
3. **Availability** — for each duty date, mark every person as `available`, `maybe`, `prefer not to`, `unavailable` (the default for anyone not yet set), or `locked in` (must do this one — an override for when someone's specifically filling in).
4. **Generate Rota** — produces several ranked candidate rotas. Every duty night gets exactly 3 people, none marked unavailable, at least one leader, one driver, and one man (can be any overlap of the same person) — a date that can't meet all of that (e.g. the only people left are one or two women with no man available) is left as **No Duty** rather than forced. Aims for at most 2 duties per person this month; a 3rd is used automatically when it's the only way to fill a date; a 4th is only ever offered as one extra, clearly-flagged candidate alongside the regular options, never silently. Also tries not to schedule anyone two duty nights in a row.
5. **Rota** — the committed rota, editable slot-by-slot for manual tweaks, with one-click copy as a list or as a formatted calendar table ready to paste into an email — the leader is bold and underlined in both, matching the old paper rota's convention.

## Repository contents

| File | Purpose |
|---|---|
| `index.html` | The app shell and config block (Sheet-backed Apps Script URL, Google OAuth client ID) |
| `core.js` | All app logic |
| `styles.css` | Styling |
| `apps-script/ssp-rota.gs.txt` | The Apps Script backend — copy into the Apps Script project bound to your Sheet |
| `apps-script/SETUP.md` | Step-by-step setup: creating the Sheet, script properties, the admin password, and deploying |

## Setting up your own deployment

See [`apps-script/SETUP.md`](apps-script/SETUP.md) — create the Sheet, attach the script, set a couple of Script Properties, deploy as a web app, and fill in `index.html`'s config block. Then push and enable GitHub Pages.

## Admin sign-in

Two independent ways in, both admin-only (there's no self-serve volunteer sign-in — availability is entered by the admin on everyone's behalf):

- **Google sign-in**, restricted to an allow-list of emails (`ADMIN_EMAILS` script property).
- **Shared password**, set via a one-time prompt run from the Apps Script editor (`setPasswordFromPrompt`) — only a salted hash is ever stored, never the plaintext, and it never appears in this repo's source.

## License

MIT — see [`LICENSE`](LICENSE).
