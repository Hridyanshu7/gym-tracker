# Stride local preview

This is a usable browser preview of the tracker. It stores activities, schedules, images, and dated results in this device's IndexedDB. It does **not** sign in or sync across devices yet; Supabase project setup is still pending.

Run from the repository root:

```sh
python3 -m http.server 5173 --directory app
```

Open `http://127.0.0.1:5173/` on the same computer. Use **Activities** to create a reusable activity with an image or GIF and schedule, or use Home **+** for a date-only activity. The service worker caches the app shell for offline opening after the first successful load.

The SQL migration draft is at `../supabase/migrations/20261030000000_initial_schema_draft.sql`. It has not been applied to a Supabase project.
