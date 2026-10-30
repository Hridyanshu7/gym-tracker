"""Create the single-user passcode account. Secrets stay in ignored .env.local."""
import json
import secrets
import urllib.error
import urllib.request
from pathlib import Path

path = Path('.env.local')
values = dict(line.split('=', 1) for line in path.read_text().splitlines() if '=' in line)
token = values['SUPABASE_ACCESS_TOKEN'].strip("\"'")
ref = values['SUPABASE_PROJECT_REF'].strip("\"'")
email = f'stride-owner-{ref}@example.com'
passcode = values.get('APP_PASSCODE', '').strip("\"'")
if not passcode:
    passcode = ''.join(str(secrets.randbelow(10)) for _ in range(12))
    with path.open('a') as file:
        file.write(f'\nAPP_PASSCODE={passcode}\n')
    path.chmod(0o600)


def request(url, method='GET', body=None, headers=None):
    headers = dict(headers or {})
    if body is not None:
        body = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers, method=method), timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Supabase request failed with HTTP {error.code}; check project permissions and account state.') from None


management = {'Authorization': f'Bearer {token}'}
keys = request(f'https://api.supabase.com/v1/projects/{ref}/api-keys?reveal=true', headers=management)
key = next((item.get('api_key') for item in keys if item.get('name') == 'service_role'), None)
if not key:
    raise SystemExit('Could not retrieve the service-role key for one-time setup.')
admin_headers = {'apikey': key, 'Authorization': f'Bearer {key}'}
users = request(f'https://{ref}.supabase.co/auth/v1/admin/users', headers=admin_headers).get('users', [])
owner = next((user for user in users if user.get('email') == email), None)
if not owner:
    owner = request(f'https://{ref}.supabase.co/auth/v1/admin/users', 'POST',
                    {'email': email, 'password': passcode, 'email_confirm': True}, admin_headers)
owner_id = owner['id']
query_url = f'https://api.supabase.com/v1/projects/{ref}/database/query'
existing = request(query_url, 'POST', {'query': 'select owner_auth_user_id from public.settings where id = true', 'read_only': True}, management)
if existing and existing[0]['owner_auth_user_id'] != owner_id:
    raise SystemExit('A different owner already exists; no ownership change made.')
if not existing:
    zone = values.get('SUPABASE_OWNER_TIME_ZONE', 'Asia/Kolkata').strip("\"'")
    if not all(char.isalnum() or char in '_+-/' for char in zone):
        raise SystemExit('Invalid time zone in .env.local')
    request(query_url, 'POST', {'query': f"insert into public.settings (owner_auth_user_id, tracker_time_zone) values ('{owner_id}', '{zone}')"}, management)
request(f'https://api.supabase.com/v1/projects/{ref}/config/auth', 'PATCH',
        {'disable_signup': True, 'external_email_enabled': True, 'external_google_enabled': False}, management)
print('Passcode account and single-user ownership are configured. Passcode is in .env.local.')
