-- =============================================================================
-- Migration: 002_leads.sql
-- Description: Creates the leads table for the law firm contact form
--              with Row-Level Security (RLS) policies.
-- =============================================================================

-- Enable UUID extension if not already enabled
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enum: practice_area
-- ---------------------------------------------------------------------------
do $$ begin
  create type practice_area_enum as enum (
    'corporate',
    'real_estate',
    'litigation',
    'family',
    'criminal',
    'employment',
    'intellectual_property',
    'tax',
    'banking_finance',
    'mergers_acquisitions',
    'administrative',
    'other'
  );
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Table: leads
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id               uuid          primary key default uuid_generate_v4(),
  full_name        text          not null check (char_length(full_name) between 2 and 120),
  email            text          not null check (email ~* '^[^@]+@[^@]+\.[^@]+$'),
  phone            text          not null check (char_length(phone) between 9 and 15),
  practice_area    practice_area_enum not null default 'other',
  message          text          not null check (char_length(message) between 10 and 2000),
  consent_given    boolean       not null default false,
  source_url       text,
  ip_address       text,
  status           text          not null default 'new'
                                  check (status in ('new', 'contacted', 'qualified', 'closed', 'spam')),
  assigned_to      uuid          references auth.users(id) on delete set null,
  notes            text,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists leads_email_idx        on public.leads (email);
create index if not exists leads_status_idx       on public.leads (status);
create index if not exists leads_practice_area_idx on public.leads (practice_area);
create index if not exists leads_created_at_idx   on public.leads (created_at desc);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at
  before update on public.leads
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.leads enable row level security;

-- Policy 1: Anonymous users (from contact form) may INSERT only.
--           They cannot read, update, or delete any rows.
create policy "anon_insert_leads"
  on public.leads
  for insert
  to anon
  with check (
    consent_given = true
    and char_length(full_name) >= 2
    and char_length(message) >= 10
  );

-- Policy 2: Authenticated staff / admin can read all leads.
create policy "authenticated_read_leads"
  on public.leads
  for select
  to authenticated
  using (true);

-- Policy 3: Authenticated staff can update leads (e.g. change status, add notes).
create policy "authenticated_update_leads"
  on public.leads
  for update
  to authenticated
  using (true)
  with check (true);

-- Policy 4: Only service-role can delete leads (hard deletes should be rare).
-- No explicit policy needed — service_role bypasses RLS by default.

-- ---------------------------------------------------------------------------
-- Revoke direct access from public schema for safety
-- ---------------------------------------------------------------------------
revoke all on public.leads from public;
grant select, insert, update on public.leads to authenticated;
grant insert on public.leads to anon;

-- ---------------------------------------------------------------------------
-- Comments for documentation
-- ---------------------------------------------------------------------------
comment on table public.leads is
  'Inbound contact form submissions from the law firm landing page. '
  'Anonymous users may insert; authenticated staff may read/update.';

comment on column public.leads.status is
  'Lead lifecycle status: new → contacted → qualified → closed | spam';

comment on column public.leads.consent_given is
  'GDPR/ILPA consent flag — must be true for insert to succeed (enforced by RLS).';

comment on column public.leads.ip_address is
  'Requester IP for abuse/spam tracking — treat as PII under Israeli privacy law.';
