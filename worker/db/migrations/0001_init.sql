-- Users + auth state
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  workos_id         TEXT NOT NULL UNIQUE,
  email             TEXT NOT NULL,
  plan              TEXT NOT NULL DEFAULT 'free',        -- 'free' | 'pro'
  free_remaining    INTEGER NOT NULL DEFAULT 5,
  credits           INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active',      -- 'active' | 'suspended'
  cs_strike_count   INTEGER NOT NULL DEFAULT 0,          -- child-safety strikes (0 or 1)
  suspended_at      INTEGER,
  suspended_reason  TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_users_workos ON users(workos_id);

-- Folders (self-referential tree)
CREATE TABLE folders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_folders_user ON folders(user_id);

-- Generations (images + videos)
CREATE TABLE generations (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id        TEXT REFERENCES folders(id) ON DELETE SET NULL,
  type             TEXT NOT NULL,                       -- 'image' | 'video'
  status           TEXT NOT NULL,                       -- 'queued' | 'running' | 'completed' | 'failed'
  prompt           TEXT NOT NULL,
  negative_prompt  TEXT,
  model            TEXT NOT NULL,
  aspect_ratio     TEXT NOT NULL,
  seed             INTEGER,
  ref_image_urls   TEXT,                                -- JSON array
  r2_key           TEXT,
  thumb_r2_key     TEXT,
  width            INTEGER,
  height           INTEGER,
  duration_s       REAL,
  credit_cost      INTEGER NOT NULL DEFAULT 0,
  fal_request_id   TEXT,
  error            TEXT,
  created_at       INTEGER NOT NULL,
  completed_at     INTEGER
);
CREATE INDEX idx_gen_user_created ON generations(user_id, created_at DESC);
CREATE INDEX idx_gen_user_folder  ON generations(user_id, folder_id);
CREATE INDEX idx_gen_user_type    ON generations(user_id, type);
CREATE INDEX idx_gen_fal_req      ON generations(fal_request_id);

-- Bookmarks
CREATE TABLE bookmarks (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, generation_id)
);
CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);

-- Prompt assistant
CREATE TABLE prompt_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_psessions_user ON prompt_sessions(user_id);

CREATE TABLE prompt_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES prompt_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,                             -- 'user' | 'assistant' | 'system'
  content    TEXT NOT NULL,
  tokens     INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_pmessages_session ON prompt_messages(session_id, created_at);

-- Credit ledger (audit trail)
CREATE TABLE credit_ledger (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta           INTEGER NOT NULL,
  reason          TEXT NOT NULL,                        -- 'generation' | 'assistant' | 'topup' | 'subscription' | 'refund' | 'monthly_refill'
  stripe_event_id TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_ledger_user ON credit_ledger(user_id, created_at DESC);

-- Stripe
CREATE TABLE stripe_customers (
  user_id              TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id   TEXT NOT NULL UNIQUE,
  subscription_id      TEXT,
  plan                 TEXT,
  renews_at            INTEGER,
  last_refill_at       INTEGER
);

-- Moderation events (audit + strike tracking)
CREATE TABLE moderation_events (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  generation_id     TEXT REFERENCES generations(id) ON DELETE SET NULL,
  prompt_excerpt    TEXT,
  categories        TEXT,                               -- JSON array of flagged category names
  category_scores   TEXT,                               -- JSON object
  flagged           INTEGER NOT NULL,                   -- 0 | 1
  action            TEXT NOT NULL,                      -- 'warn' | 'block' | 'suspend'
  created_at        INTEGER NOT NULL
);
CREATE INDEX idx_modevents_user ON moderation_events(user_id, created_at DESC);
