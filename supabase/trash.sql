-- OrgFlow — trash for deleted organograms (run once, after schema.sql).
-- A deleted organogram stays recoverable for 30 days, then is removed for good.

alter table public.charts add column if not exists deleted_at timestamptz;

-- p_restore = false moves to the trash, true brings it back
create or replace function public.trash_chart(p_id uuid, p_restore boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ready() or coalesce(public.chart_perm(p_id), '') not in ('owner', 'admin') then
    raise exception 'forbidden';
  end if;
  update charts set deleted_at = case when p_restore then null else now() end where id = p_id;
  -- trash older than 30 days is emptied whenever someone uses it
  delete from charts where deleted_at < now() - interval '30 days';
end;
$$;

revoke all on function public.trash_chart(uuid, boolean) from public, anon;
grant execute on function public.trash_chart(uuid, boolean) to authenticated;
