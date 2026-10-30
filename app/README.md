# Stride tracker

Phone-first browser tracker with offline IndexedDB data and Supabase sync. A single fixed passcode unlocks the app. The passcode is never included in the browser bundle or GitHub repository.

From the repository root:

```sh
npm ci
npm run build
python3 -m http.server 5173 --directory app
```

Open `http://127.0.0.1:5173/`. The service worker caches the app for offline use after the first load. Each device must sign in online once before it can unlock offline.

For initial cloud setup, place the Supabase project access token and project ref in ignored `.env.local`, then run `python3 scripts/setup_passcode.py`. The script generates a 12-digit passcode there if none exists, creates the sole Auth user, binds the RLS owner, and disables public signup. Run it only for the initial setup. The browser uses only the public key in `config.js`.

Use **Activities** to create a reusable activity and schedule, or Home **+** to create a date-only activity. Changes made offline sync when the device reconnects and has an active session; synced pending edits are removed while the local cache remains.
