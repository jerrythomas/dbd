-- RLS policies and grants for config.lookups

ALTER TABLE config.lookups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lookups_select_authenticated"
  ON config.lookups FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON config.lookups TO anon, authenticated;
GRANT ALL ON config.lookups TO service_role;
