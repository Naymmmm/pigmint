-- Variants: a regenerated generation links back to its parent. The original
-- generation has parent_generation_id = NULL and variant_index = 0. Each
-- regeneration increments variant_index within the chain.
ALTER TABLE generations ADD COLUMN parent_generation_id TEXT REFERENCES generations(id) ON DELETE SET NULL;
ALTER TABLE generations ADD COLUMN variant_index INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_gen_parent ON generations(parent_generation_id);

-- Comparisons: user-defined A/B (or N-way) benchmark of generations.
-- A comparison has ordered slots; each slot has a label ("Model 1") and
-- holds one or more generation refs (supports running the same prompt
-- through multiple models at once, and then regenerating variants per slot).
CREATE TABLE comparisons (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  prompt      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_cmp_user_created ON comparisons(user_id, created_at DESC);

CREATE TABLE comparison_slots (
  id             TEXT PRIMARY KEY,
  comparison_id  TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  slot_index     INTEGER NOT NULL,
  label          TEXT NOT NULL,
  model          TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_cmpslot_comparison ON comparison_slots(comparison_id, slot_index);

CREATE TABLE comparison_slot_generations (
  slot_id        TEXT NOT NULL REFERENCES comparison_slots(id) ON DELETE CASCADE,
  generation_id  TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  PRIMARY KEY (slot_id, generation_id)
);
CREATE INDEX idx_cmpgen_slot ON comparison_slot_generations(slot_id, position);
