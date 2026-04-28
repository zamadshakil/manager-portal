-- ============================================================================
-- Hierarchia Portal — Schema initialization
-- Tables, enums, indexes. RLS is enabled in script 003.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('main_admin', 'manager', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type submission_status as enum (
    'queued', 'parsing', 'validating', 'passed', 'failed', 'needs_review'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type announcement_priority as enum ('low', 'normal', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_period as enum ('day', 'month', 'year');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Teams
-- ----------------------------------------------------------------------------
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  manager_id  uuid,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        user_role not null default 'member',
  team_id     uuid references public.teams(id) on delete set null,
  manager_id  uuid references public.profiles(id) on delete set null,
  must_reset  boolean not null default false,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Wire teams.manager_id now that profiles exists
do $$ begin
  alter table public.teams
    add constraint teams_manager_fk
    foreign key (manager_id) references public.profiles(id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists profiles_team_idx    on public.profiles(team_id);
create index if not exists profiles_manager_idx on public.profiles(manager_id);
create index if not exists profiles_role_idx    on public.profiles(role);

-- ----------------------------------------------------------------------------
-- Submissions
-- ----------------------------------------------------------------------------
create table if not exists public.submissions (
  id           uuid primary key default gen_random_uuid(),
  uploader_id  uuid not null references public.profiles(id) on delete cascade,
  team_id      uuid not null references public.teams(id)    on delete cascade,
  title        text not null,
  blob_url     text not null,
  blob_pathname text,
  mime_type    text not null,
  size_bytes   bigint,
  status       submission_status not null default 'queued',
  score        numeric(5,2),
  summary      text,
  extracted_text text,
  flags        jsonb not null default '[]'::jsonb,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists submissions_team_created_idx
  on public.submissions(team_id, created_at desc);
create index if not exists submissions_status_idx on public.submissions(status);
create index if not exists submissions_uploader_idx
  on public.submissions(uploader_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Validation rules (per team, manager-configurable)
-- ----------------------------------------------------------------------------
create table if not exists public.validation_rules (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  rule_name       text not null,
  description     text,
  prompt_template text not null,
  threshold       numeric(5,2) not null default 70.00,
  weight          numeric(5,2) not null default 1.00,
  enabled         boolean not null default true,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists rules_team_idx on public.validation_rules(team_id);

-- ----------------------------------------------------------------------------
-- Validation runs (one per submission per rule run)
-- ----------------------------------------------------------------------------
create table if not exists public.validation_runs (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.submissions(id) on delete cascade,
  rule_id         uuid references public.validation_rules(id) on delete set null,
  model           text not null,
  prompt_version  text,
  raw_output      jsonb not null default '{}'::jsonb,
  pass            boolean,
  score           numeric(5,2),
  reasons         jsonb not null default '[]'::jsonb,
  flags           jsonb not null default '[]'::jsonb,
  latency_ms      integer,
  tokens_in       integer,
  tokens_out      integer,
  created_at      timestamptz not null default now()
);

create index if not exists runs_submission_idx on public.validation_runs(submission_id);

-- ----------------------------------------------------------------------------
-- Announcements
-- ----------------------------------------------------------------------------
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references public.profiles(id) on delete cascade,
  team_id     uuid references public.teams(id) on delete cascade, -- null = global
  title       text not null,
  body        text not null,
  priority    announcement_priority not null default 'normal',
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists announcements_team_created_idx
  on public.announcements(team_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Materials
-- ----------------------------------------------------------------------------
create table if not exists public.materials (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references public.profiles(id) on delete cascade,
  team_id       uuid references public.teams(id) on delete cascade, -- null = global
  title         text not null,
  description   text,
  blob_url      text not null,
  blob_pathname text,
  file_type     text,
  size_bytes    bigint,
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now()
);

create index if not exists materials_team_created_idx
  on public.materials(team_id, created_at desc);
create index if not exists materials_tags_idx on public.materials using gin(tags);

-- ----------------------------------------------------------------------------
-- Activity log (append-only)
-- ----------------------------------------------------------------------------
create table if not exists public.activity_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references public.profiles(id) on delete set null,
  team_id       uuid references public.teams(id)    on delete set null,
  action        text not null,
  entity_type   text not null,
  entity_id     uuid,
  metadata      jsonb not null default '{}'::jsonb,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index if not exists activity_actor_idx
  on public.activity_log(actor_id, created_at desc);
create index if not exists activity_team_idx
  on public.activity_log(team_id, created_at desc);
create index if not exists activity_entity_idx
  on public.activity_log(entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- Report snapshots (precomputed dashboard metrics)
-- ----------------------------------------------------------------------------
create table if not exists public.report_snapshots (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid references public.teams(id) on delete cascade, -- null = global
  period        report_period not null,
  period_start  date not null,
  metrics       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique(team_id, period, period_start)
);

create index if not exists snapshots_team_period_idx
  on public.report_snapshots(team_id, period, period_start desc);
