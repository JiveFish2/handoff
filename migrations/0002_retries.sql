-- Retries through a queue. An order that fails for a reason that may pass (the ERP down,
-- slow or rate limited) waits for its next try in `retrying`; one that cannot succeed without
-- someone fixing something (an unknown SKU, a rejected payload) or that ran out of tries goes
-- to `failed`, the failed queue, where it can be replayed.

ALTER TABLE bridge.orders DROP CONSTRAINT orders_status_check;
ALTER TABLE bridge.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('received', 'delivering', 'retrying', 'delivered', 'failed'));

-- Until now `failed` meant "try again"; it now means "needs a person".
UPDATE bridge.orders SET status = 'retrying' WHERE status = 'failed';

-- When the current try started, so a try that died half-way (a crashed function) can be
-- taken over instead of blocking the order for ever.
ALTER TABLE bridge.orders ADD COLUMN claimed_at timestamptz;

-- When the order was last handed to the queue (by the webhook, a replay or the sweep).
ALTER TABLE bridge.orders ADD COLUMN queued_at timestamptz;

-- Why a failed try failed: transient errors are retried, permanent ones are not.
ALTER TABLE bridge.attempts ADD COLUMN error_kind text CHECK (error_kind IN ('transient', 'permanent'));

-- Every replay from the failed queue, for the console.
CREATE TABLE bridge.replays (
  id          bigserial PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES bridge.orders,
  replayed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON bridge.orders (status, received_at);
