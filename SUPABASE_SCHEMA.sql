-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor > New query)
-- This creates the homes table and enables real-time sync

create table if not exists homes (
  id          text primary key,
  addr        text not null,
  hood        text,
  price       integer,
  sqft        integer,
  year        integer,
  beds        integer,
  baths       integer,
  half        integer default 0,
  ppsf        integer,
  fees        integer default 0,
  status      text default 'Active',
  oh          text default '',
  rob         numeric,
  kelly       numeric,
  pros        text default '',
  cons        text default '',
  notes       text default '',
  visited     text default '',
  compass     text default '',
  redfin      text default '',
  lat         numeric,
  lng         numeric,
  created_at  timestamptz default now()
);

-- Enable Row Level Security (keep data private but accessible via anon key)
alter table homes enable row level security;

-- Allow all operations via the anon key (fine for a private family app)
create policy "Allow all" on homes for all using (true) with check (true);

-- Enable real-time replication
alter publication supabase_realtime add table homes;
