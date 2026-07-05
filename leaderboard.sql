-- Chartle leaderboard — kör detta i Supabase: SQL Editor → New query → klistra in → Run.

create table public.scores (
  day        int not null,
  player_id  uuid not null,
  name       text not null check (char_length(name) between 1 and 20),
  day_r      numeric not null check (day_r between -100 and 100),
  created_at timestamptz not null default now(),
  primary key (day, player_id)
);

alter table public.scores enable row level security;

-- Alla får läsa och skicka in, ingen får ändra eller radera (insert-only).
create policy "anon read"   on public.scores for select to anon using (true);
create policy "anon insert" on public.scores for insert to anon with check (true);

-- Totalställning: summerad R per spelare, senaste namnet vinner.
create view public.leaderboard_total as
  select player_id,
         (array_agg(name order by created_at desc))[1] as name,
         round(sum(day_r), 1) as total_r,
         count(*) as days
  from public.scores
  group by player_id;
