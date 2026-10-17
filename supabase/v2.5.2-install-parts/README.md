# v2.5.2: Test vs Official elections

**Installation order:** 01_test_election_mode.sql (schema change) then 02_verify_test_election_mode.sql (read-only checks). Install after all v2.2–v2.5.1 migrations, and before deploying the matching v2.5.2 Worker code.

**Do not run during voting. Back up Supabase first, and rehearse on a staging clone.** The installer does not delete ballots or voter accounts. It does reclassify the exact previously verified closed mock election ID 2 as Test, if and only if its full fingerprint matches. Its transactional prechecks deliberately fail if the historical test data changed.

New test elections can be deleted only when Draft/Closed through the guarded admin workflow; Official elections are protected even in Draft. Running 01 does not itself delete any elections. Read `README_RELEASE_v2.5.2.md` for deployment/testing instructions.
