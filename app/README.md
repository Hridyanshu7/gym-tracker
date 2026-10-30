# Stride local preview

This is a browser app for the tracker. It stores activities, schedules, images, and dated results in IndexedDB for offline use. It also has Google sign-in and sync code for the linked Supabase project. Google OAuth credentials and the single-user owner row must be configured before cloud sync can be used.

Run from the repository root:

```sh
npm ci
npm run build
python3 -m http.server 5173 --directory app
```

Open `http://127.0.0.1:5173/` on the same computer. Use **Activities** to create a reusable activity with an image or GIF and schedule, or use Home **+** for a date-only activity. The service worker caches the app shell for offline opening after the first successful load.

The initial SQL migration is at `../supabase/migrations/20261030000000_initial_schema_draft.sql` and has been applied to the gym-tracker Supabase project. The publishable browser key in `config.js` is intentionally public; management tokens and database passwords remain in the ignored `.env.local` file.

## Finish Google sign-in setup

Create a Google OAuth **Web application** client. Add `http://127.0.0.1:5173` to authorized JavaScript origins and `https://bwavcibrrynjysxzqrto.supabase.co/auth/v1/callback` to authorized redirect URIs. Put the client ID and secret in the ignored root `.env.local` file as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Run `python3 scripts/configure_google.py` from the repository root to enable the provider. The local app URL is already allowed in Supabase Auth.

After signing in once with the approved Google account, set `SUPABASE_OWNER_EMAIL` in `.env.local` and run `python3 scripts/bootstrap_owner.py` from the repository root. The owner row restricts all tracker tables and media to that account. Sign out and back in, then use **Sync now** in Settings to verify the cloud connection.
