-- OrgFlow — run once in Supabase: SQL Editor → New query → paste → Run.
-- Afterwards: Authentication → Sign In / Providers → turn OFF "Allow new users to sign up".
-- The browser adds the prefix 'of-' to every password, because Supabase Auth
-- refuses passwords under 6 characters and the default password here is 123.

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  name text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  must_change boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.charts (
  id uuid primary key default gen_random_uuid(),
  owner uuid references public.profiles (id) on delete set null, -- kept when a profile is removed
  owner_name text not null,
  name text not null,
  project text not null,
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.chart_shares (
  chart_id uuid not null references public.charts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  perm text not null check (perm in ('view', 'edit')),
  primary key (chart_id, user_id)
);

/* ---------- helpers ---------- */
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- false while the default password has not been replaced
create function public.is_ready() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and not must_change);
$$;

create function public.chart_perm(c uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from charts where id = c and owner = auth.uid()) then 'owner'
    when exists (select 1 from chart_shares where chart_id = c and user_id = auth.uid())
      then (select perm from chart_shares where chart_id = c and user_id = auth.uid())
    when public.is_admin() then 'admin'
  end;
$$;

/* ---------- access rules ---------- */
alter table public.profiles enable row level security;
alter table public.charts enable row level security;
alter table public.chart_shares enable row level security;

revoke all on public.profiles, public.charts, public.chart_shares from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, delete on public.charts to authenticated;
grant update (name, project, rev, updated_at, updated_by) on public.charts to authenticated;
grant select, insert, update, delete on public.chart_shares to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_ready());

create policy charts_read on public.charts for select to authenticated
  using (public.is_ready() and (owner = auth.uid() or public.chart_perm(id) is not null));
create policy charts_add on public.charts for insert to authenticated
  with check (public.is_ready() and owner = auth.uid());
create policy charts_edit on public.charts for update to authenticated
  using (public.is_ready() and public.chart_perm(id) in ('owner', 'edit', 'admin'))
  with check (public.chart_perm(id) in ('owner', 'edit', 'admin'));
create policy charts_remove on public.charts for delete to authenticated
  using (public.is_ready() and public.chart_perm(id) in ('owner', 'admin'));

create policy shares_read on public.chart_shares for select to authenticated
  using (public.is_ready() and (user_id = auth.uid() or public.chart_perm(chart_id) in ('owner', 'admin')));
create policy shares_add on public.chart_shares for insert to authenticated
  with check (public.is_ready() and public.chart_perm(chart_id) in ('owner', 'admin'));
create policy shares_edit on public.chart_shares for update to authenticated
  using (public.is_ready() and public.chart_perm(chart_id) in ('owner', 'admin'));
create policy shares_remove on public.chart_shares for delete to authenticated
  using (public.is_ready() and public.chart_perm(chart_id) in ('owner', 'admin'));

/* ---------- accounts ---------- */
create function public.create_account(p_username text, p_name text, p_role text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := gen_random_uuid();
  mail text := p_username || '@orgflow.local';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
    crypt('of-123', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true), 'email', now(), now(), now());
  insert into public.profiles (id, username, name, role) values (uid, p_username, p_name, p_role);
end;
$$;
revoke all on function public.create_account(text, text, text) from public, anon, authenticated;

create function public.admin_create_user(p_username text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() or not public.is_ready() then raise exception 'forbidden'; end if;
  if p_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then raise exception 'bad_username'; end if;
  if exists (select 1 from profiles where username = p_username) then raise exception 'exists'; end if;
  perform public.create_account(p_username, coalesce(nullif(trim(p_name), ''), p_username), 'user');
end;
$$;

create function public.admin_reset_password(p_username text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid;
begin
  if not public.is_admin() or not public.is_ready() then raise exception 'forbidden'; end if;
  select id into uid from profiles where username = p_username;
  if uid is null then raise exception 'no_user'; end if;
  update auth.users set encrypted_password = crypt('of-123', gen_salt('bf')), updated_at = now() where id = uid;
  update profiles set must_change = true where id = uid;
end;
$$;

create function public.admin_delete_user(p_username text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_admin() or not public.is_ready() then raise exception 'forbidden'; end if;
  select id into uid from profiles where username = p_username;
  if uid is null then raise exception 'no_user'; end if;
  if uid = auth.uid() then raise exception 'self'; end if;
  delete from auth.users where id = uid; -- organograms stay, without an owner, for the administrator
end;
$$;

create function public.change_password(p_current text, p_next text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare stored text;
begin
  select encrypted_password into stored from auth.users where id = auth.uid();
  if stored is null or stored <> crypt(p_current, stored) then raise exception 'bad_password'; end if;
  if length(p_next) < 9 or p_next = 'of-123' then raise exception 'weak_password'; end if;
  update auth.users set encrypted_password = crypt(p_next, gen_salt('bf')), updated_at = now() where id = auth.uid();
  update profiles set must_change = false where id = auth.uid();
end;
$$;

revoke all on function public.admin_create_user(text, text), public.admin_reset_password(text), public.admin_delete_user(text), public.change_password(text, text) from public, anon;
grant execute on function public.admin_create_user(text, text), public.admin_reset_password(text), public.admin_delete_user(text), public.change_password(text, text) to authenticated;

-- administrator account: first access with 123, then the password must change
select public.create_account('bruno.moraes', 'Bruno Moraes', 'admin');
