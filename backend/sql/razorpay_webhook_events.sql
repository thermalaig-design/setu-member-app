-- Razorpay webhook event log: idempotency (event_id unique) and out-of-order
-- handling (transfer events that arrive before the payment row has its
-- transaction_id are parked as 'pending_match' and replayed after capture).
CREATE TABLE IF NOT EXISTS public.razorpay_webhook_events (
  event_id         text PRIMARY KEY,
  event_name       text NOT NULL,
  entity_id        text,
  payload          jsonb NOT NULL,
  event_created_at timestamptz,
  status           text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'pending_match', 'failed')),
  error            text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_razorpay_webhook_events_pending
  ON public.razorpay_webhook_events (entity_id)
  WHERE status = 'pending_match';

ALTER TABLE public.razorpay_webhook_events ENABLE ROW LEVEL SECURITY;
