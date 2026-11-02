BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL TIME ZONE 'UTC';

-- Only counts and deterministic row fingerprints leave the database.
SELECT json_build_object('table', 'schema_migrations', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY version), ''))) FROM schema_migrations t;
SELECT json_build_object('table', 'model_channels', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''))) FROM model_channels t;
SELECT json_build_object('table', 'channel_models', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''))) FROM channel_models t;
SELECT json_build_object('table', 'channel_model_price_tiers', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''))) FROM channel_model_price_tiers t;
SELECT json_build_object('table', 'credit_accounts', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY user_id), ''))) FROM credit_accounts t;
SELECT json_build_object('table', 'credit_ledger_entries', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''))) FROM credit_ledger_entries t;
SELECT json_build_object('table', 'billing_orders', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''))) FROM billing_orders t;
SELECT json_build_object('table', 'system_settings', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY key), ''))) FROM system_settings t;
SELECT json_build_object('table', 'payment_provider_configs', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''))) FROM payment_provider_configs t;
SELECT json_build_object('table', 'user_oss_settings', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''))) FROM user_oss_settings t;
SELECT json_build_object('table', 'storage_locations', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''))) FROM storage_locations t;
SELECT json_build_object('table', 'resources', 'rows', count(*), 'fingerprint', md5(COALESCE(string_agg(to_jsonb(t)::text, E'\n' ORDER BY id), ''))) FROM resources t;
ROLLBACK;
