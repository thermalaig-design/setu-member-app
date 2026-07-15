-- =====================================================
-- FIX: Duplicate Members entries (phone format mismatch)
-- Run in Supabase SQL Editor
-- =====================================================

-- STEP 1: Sabse pehle duplicates dhundho — diagnosis
-- (ye sirf dekne ke liye hai, kuch delete nahi hoga)
SELECT 
  RIGHT(REGEXP_REPLACE("Mobile", '[^0-9]', '', 'g'), 10) AS mobile_last10,
  COUNT(*) AS total_rows,
  ARRAY_AGG("S.No." ORDER BY "S.No." ASC) AS serial_nos,
  ARRAY_AGG("Mobile" ORDER BY "S.No." ASC) AS all_mobiles,
  ARRAY_AGG("Name" ORDER BY "S.No." ASC) AS all_names
FROM "Members"
WHERE "Mobile" IS NOT NULL AND LENGTH(REGEXP_REPLACE("Mobile", '[^0-9]', '', 'g')) >= 10
GROUP BY RIGHT(REGEXP_REPLACE("Mobile", '[^0-9]', '', 'g'), 10)
HAVING COUNT(*) > 1
ORDER BY total_rows DESC;

-- =====================================================
-- STEP 2: Agar duplicates mile toh unhe dekhke manually
-- decide karo kaun sa row rakhna hai.
-- Neeche ka query sabse purana row rakhega, baaki delete karega.
-- =====================================================

-- CAUTION: Yeh DELETE karega! Pehle Step 1 run karo.
-- Uncomment karke run karo jab confident ho:

/*
DELETE FROM "Members"
WHERE "S.No." IN (
  SELECT UNNEST(
    ARRAY_REMOVE(
      ARRAY_AGG("S.No." ORDER BY "S.No." ASC),
      MIN("S.No.")  -- sabse purana row rakhna hai
    )
  )
  FROM "Members"
  WHERE "Mobile" IS NOT NULL AND LENGTH(REGEXP_REPLACE("Mobile", '[^0-9]', '', 'g')) >= 10
  GROUP BY RIGHT(REGEXP_REPLACE("Mobile", '[^0-9]', '', 'g'), 10)
  HAVING COUNT(*) > 1
);
*/

-- =====================================================
-- STEP 3: Aage duplicate na ho — UNIQUE constraint lagao
-- (OPTIONAL: pehle check karo ki koi existing unique constraint toh nahi)
-- =====================================================

-- Check existing constraints:
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = '"Members"'::regclass;

-- Agar koi UNIQUE constraint nahi hai "Mobile" par:
-- ALTER TABLE "Members" ADD CONSTRAINT members_mobile_unique UNIQUE ("Mobile");

-- =====================================================
-- STEP 4: Future format normalization ke liye —
-- Normalize existing data to last 10 digits
-- =====================================================

-- Dekho current Mobile values kaisi hain:
SELECT "Mobile", LENGTH("Mobile") as len
FROM "Members"
GROUP BY "Mobile", LENGTH("Mobile")
ORDER BY len;

-- Normalize karo (uncomment to run):
/*
UPDATE "Members"
SET "Mobile" = RIGHT(REGEXP_REPLACE("Mobile", '[^0-9]', '', 'g'), 10)
WHERE "Mobile" IS NOT NULL 
  AND LENGTH(REGEXP_REPLACE("Mobile", '[^0-9]', '', 'g')) > 10;
*/
