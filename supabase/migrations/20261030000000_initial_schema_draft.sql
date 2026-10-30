-- Initial schema, applied to the gym-tracker Supabase project on 2026-10-30.
-- One-user release: create the settings row with the approved Supabase Auth
-- user ID after Google sign-in is configured. Until then, RLS denies all app data.

create extension if not exists pgcrypto;

create type public.tracking_method as enum ('yes_no', 'amount', 'duration');
create type public.schedule_kind as enum ('one_date', 'weekdays');

-- An ordered JSON array such as [12, 10, 8]. Decimal targets also work.
create function public.valid_target_segments(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
begin
  if value is null or jsonb_typeof(value) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(value) = 0 then
    return false;
  end if;
  for item in select jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'number' or (item::text)::numeric <= 0 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create table public.settings (
  id boolean primary key default true check (id),
  owner_auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  tracker_time_zone text not null,
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0)
);

create table public.category_legend (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  emoji text not null check (length(btrim(emoji)) > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0)
);
create unique index category_legend_active_name_unique
  on public.category_legend (lower(name)) where archived_at is null;

create table public.missions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0)
);
create unique index missions_active_name_unique
  on public.missions (lower(name)) where archived_at is null;

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  description text not null check (length(btrim(description)) > 0),
  category_id uuid not null references public.category_legend(id) on delete restrict,
  mission_id uuid references public.missions(id) on delete restrict,
  media_path text not null check (length(btrim(media_path)) > 0),
  tracking_method public.tracking_method not null,
  amount_unit text,
  target_segments jsonb,
  target_duration_minutes integer,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  constraint activities_target_matches_method check (
    (tracking_method = 'yes_no'
      and amount_unit is null and target_segments is null and target_duration_minutes is null)
    or (tracking_method = 'amount'
      and amount_unit is not null and length(btrim(amount_unit)) > 0
      and public.valid_target_segments(target_segments)
      and target_duration_minutes is null)
    or (tracking_method = 'duration'
      and amount_unit is null and target_segments is null
      and target_duration_minutes is not null and target_duration_minutes > 0)
  )
);
create index activities_category_idx on public.activities(category_id);
create index activities_mission_idx on public.activities(mission_id);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete restrict,
  kind public.schedule_kind not null,
  on_date date,
  weekdays smallint[],
  start_time time without time zone not null,
  starts_on date not null,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  constraint schedules_date_range check (ends_on is null or ends_on >= starts_on),
  constraint schedules_shape check (
    (kind = 'one_date' and on_date is not null and weekdays is null
      and starts_on = on_date and (ends_on is null or ends_on = on_date))
    or (kind = 'weekdays' and on_date is null and weekdays is not null
      and cardinality(weekdays) > 0
      and weekdays <@ array[1,2,3,4,5,6,7]::smallint[])
  )
);
create index schedules_activity_idx on public.schedules(activity_id);
create index schedules_dates_idx on public.schedules(starts_on, ends_on);

-- Only changed fields are stored here. This is a current plan exception,
-- never a preserved copy of an older repeating schedule.
create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  on_date date not null,
  is_cancelled boolean not null default false,
  start_time time without time zone,
  target_segments jsonb,
  target_duration_minutes integer,
  mission_override_set boolean not null default false,
  mission_id uuid references public.missions(id) on delete restrict,
  display_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (schedule_id, on_date),
  constraint exception_targets_valid check (
    (target_segments is null or public.valid_target_segments(target_segments))
    and (target_duration_minutes is null or target_duration_minutes > 0)
  ),
  constraint exception_mission_marker check (mission_override_set or mission_id is null),
  constraint exception_order_positive check (display_order is null or display_order >= 0)
);
create index schedule_exceptions_date_idx on public.schedule_exceptions(on_date);

-- One dated activity log, whether generated from a schedule or created from Home.
-- Planned target context is stored with the log; old schedule versions are not.
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  start_time time without time zone not null,
  activity_id uuid references public.activities(id) on delete restrict,
  schedule_id uuid references public.schedules(id) on delete set null,
  name text not null check (length(btrim(name)) > 0),
  description text not null check (length(btrim(description)) > 0),
  category_id uuid references public.category_legend(id) on delete set null,
  category_name text not null check (length(btrim(category_name)) > 0),
  category_emoji text not null check (length(btrim(category_emoji)) > 0),
  mission_id uuid references public.missions(id) on delete set null,
  mission_name text,
  media_path text not null check (length(btrim(media_path)) > 0),
  tracking_method public.tracking_method not null,
  amount_unit text,
  target_duration_minutes integer,
  actual_duration_minutes integer,
  yes_no_result boolean,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  constraint activity_logs_target_shape check (
    (tracking_method = 'yes_no'
      and amount_unit is null and target_duration_minutes is null
      and actual_duration_minutes is null and done_at is null)
    or (tracking_method = 'amount'
      and amount_unit is not null and length(btrim(amount_unit)) > 0
      and target_duration_minutes is null and actual_duration_minutes is null
      and yes_no_result is null)
    or (tracking_method = 'duration'
      and amount_unit is null and target_duration_minutes is not null
      and target_duration_minutes > 0
      and (actual_duration_minutes is null or actual_duration_minutes >= 0)
      and yes_no_result is null)
  )
);
create unique index activity_logs_schedule_date_unique
  on public.activity_logs(schedule_id, activity_date) where schedule_id is not null;
create index activity_logs_date_time_idx on public.activity_logs(activity_date, start_time);
create index activity_logs_activity_idx on public.activity_logs(activity_id);

create table public.set_results (
  id uuid primary key default gen_random_uuid(),
  activity_log_id uuid not null references public.activity_logs(id) on delete cascade,
  segment_number integer not null check (segment_number > 0),
  unit text not null check (length(btrim(unit)) > 0),
  target_amount numeric(12,3) not null check (target_amount > 0),
  actual_amount numeric(12,3) check (actual_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  unique (activity_log_id, segment_number)
);
create index set_results_log_idx on public.set_results(activity_log_id);

-- Keep timestamps and optimistic-concurrency revisions current on updates.
create function public.touch_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

create trigger settings_touch before update on public.settings
  for each row execute function public.touch_revision();
create trigger category_legend_touch before update on public.category_legend
  for each row execute function public.touch_revision();
create trigger missions_touch before update on public.missions
  for each row execute function public.touch_revision();
create trigger activities_touch before update on public.activities
  for each row execute function public.touch_revision();
create trigger schedules_touch before update on public.schedules
  for each row execute function public.touch_revision();
create trigger schedule_exceptions_touch before update on public.schedule_exceptions
  for each row execute function public.touch_revision();
create trigger activity_logs_touch before update on public.activity_logs
  for each row execute function public.touch_revision();
create trigger set_results_touch before update on public.set_results
  for each row execute function public.touch_revision();

-- Single-account access. The owner row is provisioned by an administrator;
-- browser clients cannot insert or delete it or change owner_auth_user_id.
alter table public.settings enable row level security;
create policy settings_select on public.settings for select to authenticated
  using ((select auth.uid()) = owner_auth_user_id);
create policy settings_update on public.settings for update to authenticated
  using ((select auth.uid()) = owner_auth_user_id)
  with check ((select auth.uid()) = owner_auth_user_id);
revoke all on public.settings from anon, authenticated;
grant select, update(tracker_time_zone) on public.settings to authenticated;

-- The settings row is readable only to the approved account. Every app table
-- uses it as the single-account access check.
do $$
declare
  table_name text;
  owner_rule text := '(select auth.uid()) = (select owner_auth_user_id from public.settings where id = true)';
begin
  foreach table_name in array array[
    'category_legend', 'missions', 'activities', 'schedules',
    'schedule_exceptions', 'activity_logs', 'set_results'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', table_name || '_select', table_name, owner_rule);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', table_name || '_insert', table_name, owner_rule);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', table_name || '_update', table_name, owner_rule, owner_rule);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', table_name || '_delete', table_name, owner_rule);
  end loop;
end;
$$;

-- Media bucket metadata is created by this migration. File uploads and
-- downloads still use the Supabase Storage API, never direct SQL writes.
insert into storage.buckets (id, name, public)
values ('activity-media', 'activity-media', false)
on conflict (id) do nothing;

create policy activity_media_select on storage.objects for select to authenticated
  using (bucket_id = 'activity-media'
    and (select auth.uid()) = (select owner_auth_user_id from public.settings where id = true));
create policy activity_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'activity-media'
    and (select auth.uid()) = (select owner_auth_user_id from public.settings where id = true));
create policy activity_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'activity-media'
    and (select auth.uid()) = (select owner_auth_user_id from public.settings where id = true));

-- Bootstrap after the approved Google account has signed in:
-- insert into public.settings (owner_auth_user_id, tracker_time_zone)
-- values ('<approved-auth-user-uuid>', '<IANA-time-zone>');
-- Seed the editable category legend through the app after bootstrap.
