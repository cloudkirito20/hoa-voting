-- Deprecated security migration. Superseded by v2.1.
-- DO NOT restore open/closed election deletion once ballots exist.
-- Run upgrade-bulk-voters-and-integrity.sql instead.
do $$ begin raise notice 'Old test-election deletion patch retired. Use the v2.1 integrity upgrade.'; end $$;
