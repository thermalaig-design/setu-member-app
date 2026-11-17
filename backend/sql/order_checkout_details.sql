-- =====================================================================
-- Checkout details: delivery address, personal/company, company GST.
--
-- 1) "Members": two saved addresses (address_1, address_2) and the member's
--    GST number. Company name already lives in "Company Name".
-- 2) order_checkout_details: a snapshot of what the member entered at
--    checkout, linked to the purchase rows of that order, so the team can
--    see where an order must go and which GST/company to bill.
-- 3) save_order_checkout_details(): the only write path for that table.
--    RLS is enabled with no policies, so the table is not directly writable.
--
-- Address JSON shape (address_1 / address_2 / order_checkout_details.address):
--   { "line1": "", "line2": "", "city": "", "state": "", "pincode": "" }
--
-- Idempotent: safe to run more than once.
-- =====================================================================

ALTER TABLE public."Members"
  ADD COLUMN IF NOT EXISTS address_1  jsonb,
  ADD COLUMN IF NOT EXISTS address_2  jsonb,
  ADD COLUMN IF NOT EXISTS gst_number text;

CREATE TABLE IF NOT EXISTS public.order_checkout_details (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid NOT NULL,
  trust_id      uuid NOT NULL,
  purchase_ids  uuid[] NOT NULL DEFAULT '{}',
  customer_type text NOT NULL DEFAULT 'personal'
                CHECK (customer_type IN ('personal', 'company')),
  company_name  text,
  gst_number    text,
  address_label text,
  address       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_checkout_details_member_idx
  ON public.order_checkout_details (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_checkout_details_purchase_ids_idx
  ON public.order_checkout_details USING gin (purchase_ids);

ALTER TABLE public.order_checkout_details ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.save_order_checkout_details(
  p_member_id    uuid,
  p_trust_id     uuid,
  p_purchase_ids uuid[],
  p_payload      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_type    text := lower(coalesce(p_payload->>'customer_type', 'personal'));
  v_address jsonb := p_payload->'address';
  v_owned   int;
  v_id      uuid;
BEGIN
  IF p_member_id IS NULL OR p_trust_id IS NULL
     OR p_purchase_ids IS NULL OR cardinality(p_purchase_ids) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_ARGUMENTS');
  END IF;

  IF v_type NOT IN ('personal', 'company') THEN
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CUSTOMER_TYPE');
  END IF;

  IF v_address IS NULL
     OR coalesce(btrim(v_address->>'line1'), '')   = ''
     OR coalesce(btrim(v_address->>'city'), '')    = ''
     OR coalesce(btrim(v_address->>'state'), '')   = ''
     OR coalesce(btrim(v_address->>'pincode'), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'ADDRESS_REQUIRED');
  END IF;

  -- Every purchase must belong to this member.
  SELECT count(*) INTO v_owned
    FROM public.product_purchases
   WHERE id = ANY (p_purchase_ids)
     AND member_id = p_member_id;

  IF v_owned <> cardinality(p_purchase_ids) THEN
    RETURN jsonb_build_object('success', false, 'error', 'PURCHASE_NOT_OWNED');
  END IF;

  -- A retry of the same order replaces its earlier snapshot.
  DELETE FROM public.order_checkout_details
   WHERE member_id = p_member_id
     AND purchase_ids && p_purchase_ids;

  INSERT INTO public.order_checkout_details
    (member_id, trust_id, purchase_ids, customer_type,
     company_name, gst_number, address_label, address)
  VALUES
    (p_member_id, p_trust_id, p_purchase_ids, v_type,
     CASE WHEN v_type = 'company' THEN nullif(btrim(p_payload->>'company_name'), '') END,
     CASE WHEN v_type = 'company' THEN nullif(upper(btrim(p_payload->>'gst_number')), '') END,
     nullif(btrim(p_payload->>'address_label'), ''),
     v_address)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'id', v_id);
END
$fn$;

GRANT EXECUTE ON FUNCTION public.save_order_checkout_details(uuid, uuid, uuid[], jsonb)
  TO anon, authenticated;
