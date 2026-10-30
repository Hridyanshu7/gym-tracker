"""Bind the single-user tracker to the approved Google account after first sign-in.

Reads SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, and SUPABASE_OWNER_EMAIL from
the ignored .env.local file. Never pass credentials on the command line.
"""

import json
import re
import urllib.error
import urllib.request
from pathlib import Path


values = dict(line.split("=", 1) for line in Path(".env.local").read_text().splitlines() if "=" in line)
token = values["SUPABASE_ACCESS_TOKEN"].strip("\"'")
project_ref = values["SUPABASE_PROJECT_REF"]
email = values["SUPABASE_OWNER_EMAIL"].strip("\"'").strip()
time_zone = values.get("SUPABASE_OWNER_TIME_ZONE", "Asia/Kolkata").strip("\"'")
if not re.fullmatch(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", email):
    raise SystemExit("Set a valid SUPABASE_OWNER_EMAIL in .env.local")
if not re.fullmatch(r"[A-Za-z0-9_+\-/]+", time_zone):
    raise SystemExit("Set a valid IANA time zone")


def query(sql, read_only=False):
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
        data=json.dumps({"query": sql, "read_only": read_only}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Supabase returned HTTP {error.code}: {error.read().decode()[:300]}") from None


approved = query("select id from auth.users where lower(email) = lower('" + email.replace("'", "''") + "')", True)
if len(approved) != 1:
    raise SystemExit("Approved Google account has not signed in yet, or email is not unique.")
owner_id = approved[0]["id"]
existing = query("select owner_auth_user_id from public.settings where id = true", True)
if existing and existing[0]["owner_auth_user_id"] != owner_id:
    raise SystemExit("A different account already owns this tracker; no change made.")
if not existing:
    query(
        "insert into public.settings (owner_auth_user_id, tracker_time_zone) "
        f"values ('{owner_id}', '{time_zone}')"
    )
print("Single-user owner is configured. Sync can now start.")
