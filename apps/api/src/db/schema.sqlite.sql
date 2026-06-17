pragma foreign_keys = on;

create table if not exists users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  role text not null default 'admin',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists app_settings (
  id integer primary key default 1 check (id = 1),
  mailbox_address text not null default '',
  owner_emails text not null default '{}',
  default_manual_email text not null default '',
  room_auto_approve_enabled integer not null default 1,
  knowledge_base_enabled integer not null default 1,
  mail_sync_enabled integer not null default 0,
  room_rules text not null default '{"allowedRooms":[],"maxParticipants":30,"allowedPurposes":[]}',
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists sync_states (
  mailbox_address text primary key,
  delta_link text,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  to_recipients text not null default '[]',
  cc_recipients text not null default '[]',
  received_at text not null,
  body_text text not null default '',
  has_attachments integer not null default 0,
  category text not null default 'other',
  status text not null default 'new',
  needs_review integer not null default 1,
  extracted text not null default '{}',
  overview text,
  recommendation text,
  error text,
  processed_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
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
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (message_id, graph_attachment_id)
);

create table if not exists reply_drafts (
  id text primary key,
  message_id text not null references messages(id) on delete cascade,
  to_email text not null,
  cc_emails text not null default '[]',
  subject text not null,
  body text not null,
  status text not null default 'draft',
  created_by_ai integer not null default 1,
  sent_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  sent_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
  sent_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table if not exists knowledge_entries (
  id text primary key,
  category text not null,
  question text not null,
  answer text not null,
  enabled integer not null default 1,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index if not exists idx_knowledge_entries_category on knowledge_entries(category);

create table if not exists audit_logs (
  id text primary key,
  message_id text references messages(id) on delete set null,
  actor text not null default 'system',
  action text not null,
  detail text not null default '{}',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
