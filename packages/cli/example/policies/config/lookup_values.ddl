-- RLS policies and grants for config.lookup_values

ALTER TABLE config.lookup_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lookup_values_select_authenticated"
  ON config.lookup_values FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON config.lookup_values TO anon, authenticated;
GRANT ALL ON config.lookup_values TO service_role;
