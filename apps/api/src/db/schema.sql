create table if not exists users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

create table if not exists app_settings (
  id integer primary key default 1 check (id = 1),
  mailbox_address text not null default '',
  owner_emails jsonb not null default '{}'::jsonb,
  default_manual_email text not null default '',
  room_auto_approve_enabled boolean not null default true,
  knowledge_base_enabled boolean not null default true,
  mail_sync_enabled boolean not null default false,
  room_rules jsonb not null default '{"allowedRooms":[],"maxParticipants":30,"allowedPurposes":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists sync_states (
  mailbox_address text primary key,
  delta_link text,
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id text primary key,
  mailbox_address text not null,
  graph_message_id text not null,
  internet_message_id text,
  conversation_id text,
  subject text not null,
  sender_name text,
  sender_email text not null,
  to_recipients jsonb not null default '[]'::jsonb,
  cc_recipients jsonb not null default '[]'::jsonb,
  received_at timestamptz not null,
  body_text text not null default '',
  has_attachments boolean not null default false,
  category text not null default 'other',
  status text not null default 'new',
  needs_review boolean not null default true,
  extracted jsonb not null default '{}'::jsonb,
  overview text,
  recommendation text,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_address, graph_message_id)
);

create index if not exists idx_messages_category on messages(category);
create index if not exists idx_messages_status on messages(status);
create index if not exists idx_messages_received_at on messages(received_at desc);

create table if not exists attachments (
  id text primary key,
  message_id text not null references messages(id) on delete cascade,
  graph_attachment_id text not null,
  name text not null,
  content_type text not null default 'application/octet-stream',
  size integer not null default 0,
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (message_id, graph_attachment_id)
);

create table if not exists reply_drafts (
  id text primary key,
  message_id text not null references messages(id) on delete cascade,
  to_email text not null,
  cc_emails jsonb not null default '[]'::jsonb,
  subject text not null,
  body text not null,
  status text not null default 'draft',
  created_by_ai boolean not null default true,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reply_drafts_status on reply_drafts(status);

create table if not exists forward_records (
  id text primary key,
  message_id text not null references messages(id) on delete cascade,
  to_email text not null,
  subject text not null,
  summary text not null,
  status text not null default 'pending',
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists send_logs (
  id text primary key,
  message_id text references messages(id) on delete set null,
  draft_id text references reply_drafts(id) on delete set null,
  kind text not null,
  to_email text not null,
  subject text not null,
  status text not null,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists knowledge_entries (
  id text primary key,
  category text not null,
  question text not null,
  answer text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_knowledge_entries_category on knowledge_entries(category);

create table if not exists audit_logs (
  id text primary key,
  message_id text references messages(id) on delete set null,
  actor text not null default 'system',
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
