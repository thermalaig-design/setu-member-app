-- #2: allow Razorpay methods and the pending-row placeholder.
-- Drop the legacy name too: CHECK constraints apply together, so leaving
-- this older constraint would still reject Razorpay and other new modes.
ALTER TABLE public.product_payments
  DROP CONSTRAINT IF EXISTS product_payments_mode_check;
ALTER TABLE public.product_payments
  DROP CONSTRAINT IF EXISTS product_payments_payment_mode_check;
ALTER TABLE public.product_payments
  ADD CONSTRAINT product_payments_payment_mode_check
  CHECK (payment_mode = ANY (ARRAY[
    'upi', 'card', 'netbanking', 'wallet', 'emi', 'paylater',
    'cash', 'cheque', 'razorpay'
  ]));

-- #3: one cart payment shares a transaction ID across multiple invoices.
DROP INDEX IF EXISTS public.idx_unique_transaction_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_payments_invoice_transaction
  ON public.product_payments (invoice_id, transaction_id)
  WHERE transaction_id IS NOT NULL;
