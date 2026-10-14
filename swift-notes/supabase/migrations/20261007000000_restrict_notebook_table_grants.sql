-- Keep SwiftNotes data accessible to signed-in app users only.
-- Existing RLS policies still scope each row to its Clerk user ID.
-- Supabase project owners and service_role access are unchanged.

begin;

alter table public.notebooks enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;

revoke all privileges on table
  public.notebooks,
  public.notes,
  public.attachments
from anon;

revoke all privileges on table
  public.notebooks,
  public.notes,
  public.attachments
from authenticated;

grant select, insert, update, delete on table
  public.notebooks,
  public.notes,
  public.attachments
to authenticated;

commit;
