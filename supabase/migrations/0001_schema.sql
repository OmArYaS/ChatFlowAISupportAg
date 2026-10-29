-- ChatFlow schema — run in the Supabase SQL editor (order matters).

create extension if not exists vector;

-- ================================================================== sites ====
-- One row per embeddable widget. `site_key` is the public identifier embedded
-- in customer pages; secrets never live in the widget.
create table if not exists sites (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  url           text not null,
  site_key      text not null unique default encode(gen_random_bytes(12), 'hex'),
  agent_name    text not null default 'Support Assistant',
  greeting      text not null default 'Hi! How can we help you today?',
  system_prompt text not null default 'You are a helpful support agent. Answer using the provided context. If the answer is not in the context, say you don''t know and suggest contacting support.',
  limits        jsonb not null default '{"pages_max":50,"messages_per_hour_per_visitor":20,"temperature":0.2}',
  crawl_status  text not null default 'idle' check (crawl_status in ('idle','running','done','failed')),
  created_at    timestamptz not null default now()
);

-- One owner per site, enforced so RLS keys off owner_id alone.
alter table sites enable row level security;

create policy "owners read own sites"
  on sites for select using (auth.uid() = owner_id);
create policy "owners create own sites"
  on sites for insert with check (auth.uid() = owner_id);
create policy "owners update own sites"
  on sites for update using (auth.uid() = owner_id);
create policy "owners delete own sites"
  on sites for delete using (auth.uid() = owner_id);

-- ================================================================== pages ====
create table if not exists pages (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references sites(id) on delete cascade,
  url         text not null,
  title       text,
  fetched_at  timestamptz not null default now(),
  unique (site_id, url)
);
create index if not exists pages_site_idx on pages (site_id);

alter table pages enable row level security;
create policy "owners read own pages"
  on pages for select using (
    exists (select 1 from sites s where s.id = pages.site_id and s.owner_id = auth.uid())
  );

-- =============================================================== chunks ======
-- ~500-token text chunks with embeddings. Similarity search runs through the
-- match_chunks RPC so raw table access (and its vectors) stays server-side.
create table if not exists chunks (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references sites(id) on delete cascade,
  page_id    uuid not null references pages(id) on delete cascade,
  content    text not null,
  embedding  vector(1536) not null,
  created_at timestamptz not null default now()
);
create index if not exists chunks_site_idx on chunks (site_id);
-- cosine similarity over the site's chunks; ivfflat keeps scans sublinear
create index if not exists chunks_embedding_idx
  on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table chunks enable row level security;
create policy "owners read own chunks"
  on chunks for select using (
    exists (select 1 from sites s where s.id = chunks.site_id and s.owner_id = auth.uid())
  );

-- nearest-neighbour search; `auth-less` and callable by anon because the
-- site_id is a public key and the RPC only ever returns text content.
create or replace function match_chunks(
  p_site_id uuid,
  p_embedding vector(1536),
  p_k integer default 5
)
returns table (
  content text,
  url text,
  title text,
  similarity float
)
language sql stable
as $$
  select c.content,
         p.url,
         p.title,
         1 - (c.embedding <=> p_embedding) as similarity
  from chunks c
  join pages p on p.id = c.page_id
  where c.site_id = p_site_id
    and 1 - (c.embedding <=> p_embedding) > 0.3
  order by c.embedding <=> p_embedding
  limit greatest(p_k, 1);
$$;

grant execute on function match_chunks(uuid, vector(1536), integer) to anon, authenticated;

-- ========================================================== conversations ====
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references sites(id) on delete cascade,
  visitor_id  text not null,                          -- anonymous browser id
  started_at  timestamptz not null default now(),
  last_at     timestamptz not null default now()
);
create index if not exists conversations_site_idx on conversations (site_id, last_at desc);

alter table conversations enable row level security;
create policy "owners read own conversations"
  on conversations for select using (
    exists (select 1 from sites s where s.id = conversations.site_id and s.owner_id = auth.uid())
  );

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  site_id         uuid not null references sites(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  sources         jsonb,     -- [{url,title}] the assistant grounded its answer on
  latency_ms      integer,
  model           text,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at);
create index if not exists messages_site_created_idx on messages (site_id, created_at desc);

alter table messages enable row level security;
create policy "owners read own messages"
  on messages for select using (
    exists (select 1 from sites s where s.id = messages.site_id and s.owner_id = auth.uid())
  );

-- ============================================================= analytics =====
-- Append-only funnel events: widget_loaded, question_answered, fallback_rate_limited...
create table if not exists events (
  id         bigint generated always as identity primary key,
  site_id    uuid not null references sites(id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}',
  visitor_id text,
  created_at timestamptz not null default now()
);
create index if not exists events_site_idx on events (site_id, created_at desc);

alter table events enable row level security;
create policy "owners read own events"
  on events for select using (
    exists (select 1 from sites s where s.id = events.site_id and s.owner_id = auth.uid())
  );

-- ========================================================= simple analytics ==
create or replace view site_stats as
select
  s.id                                                                            as site_id,
  count(distinct c.id)                                                            as conversations,
  (select count(*) from messages m
    where m.site_id = s.id and m.role = 'user'
      and m.created_at > now() - interval '7 days')                               as questions_7d,
  (
    select avg(m.latency_ms) from messages m
    where m.site_id = s.id and m.role = 'assistant'
      and m.latency_ms is not null
  )                                                                               as avg_answer_ms,
  (
    select count(*) filter (where m.sources is null or jsonb_array_length(m.sources) = 0)
    from messages m where m.site_id = s.id and m.role = 'assistant'
  )::float / greatest((select count(*) from messages m
                        where m.site_id = s.id and m.role = 'assistant'), 1)      as no_context_ratio
from sites s
left join conversations c on c.site_id = s.id
group by s.id;
