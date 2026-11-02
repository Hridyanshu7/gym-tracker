-- An activity can be planned and logged without a clock time.
alter table public.schedules alter column start_time drop not null;
alter table public.activity_logs alter column start_time drop not null;

-- Null normally means "inherit" in an exception. This marker lets a one-date
-- exception explicitly clear a repeating activity's start time.
alter table public.schedule_exceptions
  add column start_time_override_set boolean not null default false;
update public.schedule_exceptions
set start_time_override_set = true
where start_time is not null;
