-- v2.5.2 / Part 2: READ ONLY. All booleans must be TRUE.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='elections'
      AND column_name='is_test' AND data_type='boolean') AS test_flag_present,
  EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE c.oid='public.elections'::regclass AND NOT t.tgisinternal
      AND t.tgname='trg_hoa_guard_election_type_immutable' AND t.tgenabled='O') AS type_immutable_trigger,
  EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE c.oid='public.elections'::regclass AND NOT t.tgisinternal
      AND t.tgname='trg_hoa_guard_election_delete_mode' AND t.tgenabled='O') AS official_delete_guard,
  to_regprocedure('public.hoa_delete_test_election(bigint,bigint,text)') IS NOT NULL
    AS test_delete_rpc_present,
  has_function_privilege('service_role','public.hoa_delete_test_election(bigint,bigint,text)','EXECUTE')
    AS service_role_can_delete_test,
  NOT has_function_privilege('anon','public.hoa_delete_test_election(bigint,bigint,text)','EXECUTE')
    AS anon_cannot_delete_test,
  NOT has_function_privilege('authenticated','public.hoa_delete_test_election(bigint,bigint,text)','EXECUTE')
    AS authenticated_cannot_delete_test,
  NOT has_function_privilege('service_role','public.hoa_delete_election(bigint)','EXECUTE')
    AS legacy_delete_rpc_disabled,
  (SELECT is_test=true FROM public.elections WHERE id=2 AND title='2026 Hoa Election')
    AS verified_old_mock_id2_is_test,
  NOT EXISTS(SELECT 1 FROM public.elections WHERE is_test IS NULL)
    AS every_election_classified;
