export interface Migration {
  id: string;
  sql: string;
}

// Expand then contract: the old container keeps serving during a redeploy, so a release may only add
// to the schema. Removing a column or table waits for a later release. Never edit an applied migration.
export const MIGRATIONS: Migration[] = [
  {
    id: '001_accounts_and_results',
    sql: `
create table users (
  id uuid primary key default gen_random_uuid(),
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table identities (
  provider text not null check (provider = 'google'),
  provider_user_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, provider_user_id)
);

create table sessions (
  token_hash bytea primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_id_idx on sessions(user_id);
create index sessions_expires_at_idx on sessions(expires_at);

create table game_results (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  game_id text not null,
  mode text not null check (mode in ('solitaire','multiplayer')),
  outcome text not null check (outcome in ('won','lost','abandoned')),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_ms int not null,
  turns int not null,
  player_count int not null,
  cards_total int not null,
  cards_left int not null,
  my_cards_played int not null,
  my_total_movement int not null,
  my_special_plays int not null,
  my_nas_cheats int not null,
  hand_size int not null,
  min_cards_per_turn int not null,
  max_card int not null,
  settings jsonb not null,
  unique (user_id, game_id)
);
create index game_results_user_ended_idx on game_results(user_id, ended_at desc);
`
  }
];
