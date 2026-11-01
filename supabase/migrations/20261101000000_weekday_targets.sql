-- Optional target overrides for each selected weekday, keyed by ISO weekday (1–7).
-- A schedule stays current-only; dated activity logs preserve historical targets.
create function public.valid_weekday_targets(target_map jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  day text;
  target jsonb;
begin
  if target_map is null or jsonb_typeof(target_map) <> 'object' then return false; end if;
  for day, target in select entry.key, entry.value from jsonb_each(target_map) as entry loop
    if day !~ '^[1-7]$' or jsonb_typeof(target) <> 'object' then return false; end if;
    if target ? 'targets' then
      if not public.valid_target_segments(target->'targets') then return false; end if;
    end if;
    if target ? 'targetMinutes' then
      if jsonb_typeof(target->'targetMinutes') <> 'number'
        or (target->>'targetMinutes')::numeric <= 0
        or (target->>'targetMinutes')::numeric <> trunc((target->>'targetMinutes')::numeric)
      then return false; end if;
    end if;
    if not (target ? 'targets') and not (target ? 'targetMinutes') then return false; end if;
  end loop;
  return true;
end;
$$;

alter table public.schedules
  add column weekday_targets jsonb not null default '{}'::jsonb
  constraint schedules_weekday_targets_valid check (public.valid_weekday_targets(weekday_targets));
