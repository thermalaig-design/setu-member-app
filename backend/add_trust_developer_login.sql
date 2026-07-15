-- Adds developer login fields in Trust table (safe to run multiple times)
ALTER TABLE public."Trust"
  ADD COLUMN IF NOT EXISTS developer_mobile text,
  ADD COLUMN IF NOT EXISTS developer_secret_code text,
  ADD COLUMN IF NOT EXISTS secret_code text;

-- Optional: enforce one developer mobile per trust (nullable-safe uniqueness)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'trust_developer_mobile_unique_idx'
  ) THEN
    CREATE UNIQUE INDEX trust_developer_mobile_unique_idx
      ON public."Trust" (developer_mobile)
      WHERE developer_mobile IS NOT NULL;
  END IF;
END $$;

-- Example update by trust id
-- Replace values before running.
UPDATE public."Trust"
SET
  developer_mobile = '9911223344',
  developer_secret_code = '987654'
WHERE id = 'YOUR_TRUST_UUID_HERE';

-- Example update by trust name
-- UPDATE public."Trust"
-- SET developer_mobile = '9911223344',
--     developer_secret_code = '987654'
-- WHERE name = 'MAHARAJA AGRASEN HOSPITAL';

-- Check data
SELECT id, name, developer_mobile, developer_secret_code, secret_code
FROM public."Trust"
ORDER BY name;
