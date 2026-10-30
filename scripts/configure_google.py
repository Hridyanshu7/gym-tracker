"""Enable Google sign-in using credentials kept in the ignored .env.local file."""

import json
import urllib.error
import urllib.request
from pathlib import Path


values = dict(line.split("=", 1) for line in Path(".env.local").read_text().splitlines() if "=" in line)
required = ("SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")
missing = [key for key in required if not values.get(key)]
if missing:
    raise SystemExit("Missing .env.local values: " + ", ".join(missing))

payload = {
    "external_google_enabled": True,
    "external_google_client_id": values["GOOGLE_CLIENT_ID"].strip("\"'"),
    "external_google_secret": values["GOOGLE_CLIENT_SECRET"].strip("\"'"),
}
request = urllib.request.Request(
    "https://api.supabase.com/v1/projects/" + values["SUPABASE_PROJECT_REF"] + "/config/auth",
    data=json.dumps(payload).encode(),
    headers={
        "Authorization": "Bearer " + values["SUPABASE_ACCESS_TOKEN"].strip("\"'"),
        "Content-Type": "application/json",
    },
    method="PATCH",
)
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise SystemExit(f"Supabase returned HTTP {response.status}")
except urllib.error.HTTPError as error:
    raise SystemExit(f"Supabase returned HTTP {error.code}: {error.read().decode()[:300]}") from None
print("Google provider enabled. Credentials stayed out of GitHub.")
