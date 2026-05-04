-- Add expires_at to materials table and create indexes for cleanup
alter table public.materials add column if not exists expires_at timestamptz;

create index if not exists materials_expires_idx on public.materials(expires_at) where expires_at is not null;
create index if not exists announcements_expires_idx on public.announcements(expires_at) where expires_at is not null;
