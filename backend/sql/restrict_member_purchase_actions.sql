-- =====================================================================
-- manage_purchase_by_member: reject upsert_invoice / upsert_payment /
-- upsert_renewal.
--
-- These actions are callable by members (anon key) and are not scoped to
-- the caller, so anyone could create/alter invoices, mark a payment
-- 'success' (which fires the activation trigger) or write renewal history.
-- Invoices and payments are now created server-side by the rzp_* functions.
--
-- The function body is patched in place (not re-typed) so every other
-- action keeps its exact current behaviour. Idempotent.
-- If the admin panel uses these actions through this RPC, move it to a
-- service_role backend endpoint BEFORE applying.
-- =====================================================================
DO $patch$
DECLARE
  v_def     text;
  v_marker  text := E'  ELSIF p_action = ''upsert_invoice'' THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'manage_purchase_by_member';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'manage_purchase_by_member not found';
  END IF;
  IF position('ACTION_NOT_ALLOWED' IN v_def) > 0 THEN
    RAISE NOTICE 'already patched';
    RETURN;
  END IF;
  IF position(v_marker IN v_def) = 0 THEN
    RAISE EXCEPTION 'patch anchor not found; function changed, patch manually';
  END IF;

  v_def := replace(
    v_def,
    v_marker,
    E'  ELSIF p_action IN (''upsert_invoice'', ''upsert_payment'', ''upsert_renewal'') THEN\n'
    || E'    RETURN jsonb_build_object(''success'', false, ''error'', ''ACTION_NOT_ALLOWED'');\n'
    || v_marker
  );

  EXECUTE v_def;
END
$patch$;
