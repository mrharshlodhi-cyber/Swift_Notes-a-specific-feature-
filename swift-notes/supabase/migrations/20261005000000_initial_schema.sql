-- SwiftNotes initial database schema.
-- Authentication is handled by Clerk. Supabase receives the Clerk user ID
-- in auth.jwt()->>'sub' and uses it in Row Level Security policies.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- A notebook is a subject folder such as DBMS or Maths.
create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default (auth.jwt() ->> 'sub'),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notebooks_owner_name_unique
  on public.notebooks (owner_id, lower(name));

-- Notes, summaries, mind maps, and video notes are all files in a notebook.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default (auth.jwt() ->> 'sub'),
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  source_note_id uuid references public.notes(id) on delete set null,
  title text not null default 'Untitled note',
  content text not null default '',
  kind text not null default 'manual'
    check (kind in ('manual', 'ai_notes', 'summary', 'mind_map', 'video_notes')),
  source_type text
    check (source_type is null or source_type in ('text', 'image', 'pdf', 'youtube')),
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notes_owner_notebook_idx
  on public.notes (owner_id, notebook_id, created_at desc);
create index if not exists notes_source_note_idx
  on public.notes (source_note_id);

-- The actual image/PDF bytes live in Storage. This table holds their metadata.
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default (auth.jwt() ->> 'sub'),
  note_id uuid not null references public.notes(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  storage_path text not null unique,
  file_size bigint not null check (file_size >= 0),
  created_at timestamptz not null default now()
);

create index if not exists attachments_owner_note_idx
  on public.attachments (owner_id, note_id);

drop trigger if exists notebooks_set_updated_at on public.notebooks;
create trigger notebooks_set_updated_at
  before update on public.notebooks
  for each row execute function public.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- Enable row-level security before allowing client access.
alter table public.notebooks enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;

drop policy if exists "Users manage their own notebooks" on public.notebooks;
create policy "Users manage their own notebooks"
  on public.notebooks
  for all
  to authenticated
  using (owner_id = (select auth.jwt() ->> 'sub'))
  with check (owner_id = (select auth.jwt() ->> 'sub'));

drop policy if exists "Users manage notes in their own notebooks" on public.notes;
create policy "Users manage notes in their own notebooks"
  on public.notes
  for all
  to authenticated
  using (
    owner_id = (select auth.jwt() ->> 'sub')
    and exists (
      select 1
      from public.notebooks
      where notebooks.id = notes.notebook_id
        and notebooks.owner_id = (select auth.jwt() ->> 'sub')
    )
  )
  with check (
    owner_id = (select auth.jwt() ->> 'sub')
    and exists (
      select 1
      from public.notebooks
      where notebooks.id = notes.notebook_id
        and notebooks.owner_id = (select auth.jwt() ->> 'sub')
    )
  );

drop policy if exists "Users manage attachments on their own notes" on public.attachments;
create policy "Users manage attachments on their own notes"
  on public.attachments
  for all
  to authenticated
  using (
    owner_id = (select auth.jwt() ->> 'sub')
    and exists (
      select 1
      from public.notes
      where notes.id = attachments.note_id
        and notes.owner_id = (select auth.jwt() ->> 'sub')
    )
  )
  with check (
    owner_id = (select auth.jwt() ->> 'sub')
    and exists (
      select 1
      from public.notes
      where notes.id = attachments.note_id
        and notes.owner_id = (select auth.jwt() ->> 'sub')
    )
  );

-- Private bucket for pasted images, uploaded images, and PDFs (10 MB max each).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'swiftnotes-files',
  'swiftnotes-files',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users read their SwiftNotes files" on storage.objects;
create policy "Users read their SwiftNotes files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'swiftnotes-files'
    and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
  );

drop policy if exists "Users upload their SwiftNotes files" on storage.objects;
create policy "Users upload their SwiftNotes files"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'swiftnotes-files'
    and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
  );

drop policy if exists "Users update their SwiftNotes files" on storage.objects;
create policy "Users update their SwiftNotes files"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'swiftnotes-files'
    and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
  )
  with check (
    bucket_id = 'swiftnotes-files'
    and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
  );

drop policy if exists "Users delete their SwiftNotes files" on storage.objects;
create policy "Users delete their SwiftNotes files"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'swiftnotes-files'
    and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
  );
