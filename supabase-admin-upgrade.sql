-- CADET LOUNGE FOOSBALL — ADMIN UPGRADE
--
-- Run this ONCE in Supabase > SQL Editor, AFTER supabase-setup.sql has
-- already been run and the site has real players/matches in it. It adds a
-- PIN-gated way to fix or remove matches and players directly from the
-- website, so you no longer need to use Supabase's Table Editor.
--
-- BEFORE RUNNING: change '2468' below (in the "insert into admin_settings"
-- statement) to whatever PIN you want your admins to use. This is the PIN
-- people will type into the site's "Unlock admin mode" button.
--
-- To change the PIN again later, come back to SQL Editor and run:
--   update public.admin_settings set pin_hash = crypt('NEW_PIN_HERE', gen_salt('bf'));

create extension if not exists pgcrypto;

-- Holds only the hashed PIN. Row Level Security is enabled with NO policies,
-- so this table is completely unreachable through the public API — nobody
-- can select, insert, update, or delete it directly. Only the functions
-- below (which run with the table owner's privileges) can read it.
create table if not exists public.admin_settings (
  id boolean primary key default true,
  pin_hash text not null,
  constraint admin_settings_singleton check (id)
);
alter table public.admin_settings enable row level security;
revoke all on table public.admin_settings from anon, authenticated;

insert into public.admin_settings (id, pin_hash)
values (true, crypt('2468', gen_salt('bf')))
on conflict (id) do nothing;

-- Let removing a player also remove their match history, instead of being
-- blocked by it.
alter table public.games drop constraint if exists games_player_one_id_fkey;
alter table public.games drop constraint if exists games_player_two_id_fkey;
alter table public.games drop constraint if exists games_winner_id_fkey;
alter table public.games
  add constraint games_player_one_id_fkey foreign key (player_one_id) references public.players(id) on delete cascade,
  add constraint games_player_two_id_fkey foreign key (player_two_id) references public.players(id) on delete cascade,
  add constraint games_winner_id_fkey foreign key (winner_id) references public.players(id) on delete cascade;

-- Optional final score for each side. Nullable so existing matches (and any
-- match recorded without a score) stay valid.
alter table public.games add column if not exists player_one_score integer;
alter table public.games add column if not exists player_two_score integer;

alter table public.games drop constraint if exists games_scores_non_negative;
alter table public.games drop constraint if exists games_scores_consistent;
alter table public.games
  add constraint games_scores_non_negative check (
    (player_one_score is null or player_one_score >= 0) and
    (player_two_score is null or player_two_score >= 0)
  ),
  add constraint games_scores_consistent check (
    player_one_score is null or player_two_score is null or (
      player_one_score <> player_two_score and (
        (winner_id = player_one_id and player_one_score > player_two_score) or
        (winner_id = player_two_id and player_two_score > player_one_score)
      )
    )
  );

-- Raises an error unless p_pin matches the stored admin PIN.
-- search_path includes "extensions" because Supabase installs pgcrypto
-- (crypt/gen_salt) there rather than into "public".
create or replace function public.admin_check_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_pin is null or not exists (
    select 1 from public.admin_settings
    where id = true and pin_hash = crypt(p_pin, pin_hash)
  ) then
    raise exception 'Incorrect PIN' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.admin_update_game(
  p_game_id uuid, p_pin text,
  p_player_one_id uuid, p_player_two_id uuid, p_winner_id uuid,
  p_player_one_score integer default null, p_player_two_score integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_check_pin(p_pin);
  update public.games
  set player_one_id = p_player_one_id,
      player_two_id = p_player_two_id,
      winner_id = p_winner_id,
      player_one_score = p_player_one_score,
      player_two_score = p_player_two_score
  where id = p_game_id;
end;
$$;

create or replace function public.admin_delete_game(p_game_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_check_pin(p_pin);
  delete from public.games where id = p_game_id;
end;
$$;

create or replace function public.admin_update_player(p_player_id uuid, p_pin text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_check_pin(p_pin);
  update public.players set name = trim(p_name) where id = p_player_id;
end;
$$;

create or replace function public.admin_delete_player(p_player_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.admin_check_pin(p_pin);
  delete from public.players where id = p_player_id;
end;
$$;

grant execute on function public.admin_check_pin(text) to anon, authenticated;
grant execute on function public.admin_update_game(uuid, text, uuid, uuid, uuid, integer, integer) to anon, authenticated;
grant execute on function public.admin_delete_game(uuid, text) to anon, authenticated;
grant execute on function public.admin_update_player(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_delete_player(uuid, text) to anon, authenticated;

-- NOTE: the raw players/games tables still only grant select+insert to
-- anon/authenticated (see supabase-setup.sql) — direct UPDATE/DELETE calls
-- from the browser stay blocked. Editing and deleting only happens through
-- the functions above, which check the PIN server-side before touching
-- anything. Anyone can see this file's contents (or app.js), but that just
-- shows *how* the gate works, not the PIN itself — the PIN is only ever
-- checked as a hash inside Postgres.
