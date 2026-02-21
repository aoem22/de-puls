CREATE TABLE user_favorites (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id  TEXT NOT NULL,
  record_id  TEXT NOT NULL REFERENCES crime_records(id) ON DELETE CASCADE,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, record_id)
);

CREATE INDEX idx_user_favorites_device ON user_favorites(device_id);

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read favorites"  ON user_favorites FOR SELECT TO public USING (true);
CREATE POLICY "Public insert favorites" ON user_favorites FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Public delete favorites" ON user_favorites FOR DELETE TO public USING (true);
CREATE POLICY "Public update favorites" ON user_favorites FOR UPDATE TO public USING (true) WITH CHECK (true);
