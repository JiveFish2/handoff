-- Two schemas in one database: `bridge` is the integration, `erp` is the fictional ERP it
-- talks to. They never read each other's tables; the bridge reaches the ERP over HTTP only.

CREATE SCHEMA bridge;
CREATE SCHEMA erp;

-- ── ERP ──────────────────────────────────────────────────────────────────────────────────

CREATE TABLE erp.items (
  code  text PRIMARY KEY,                 -- the ERP's own item code, e.g. KH-ETH-250
  name  text NOT NULL,
  stock integer NOT NULL                  -- may go negative: the ERP books backorders
);

CREATE SEQUENCE erp.order_number START 10001;

CREATE TABLE erp.orders (
  ref              text PRIMARY KEY DEFAULT 'SO-' || nextval('erp.order_number'),
  -- Like many real ERPs, the external reference is searchable but not unique. Avoiding
  -- duplicates is the caller's job, which is the point of this project.
  external_ref     text NOT NULL,
  customer_account text NOT NULL,
  total            numeric(10, 2) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON erp.orders (external_ref);

CREATE TABLE erp.order_lines (
  order_ref  text NOT NULL REFERENCES erp.orders ON DELETE CASCADE,
  line       integer NOT NULL,
  item_code  text NOT NULL REFERENCES erp.items,
  quantity   integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(10, 2) NOT NULL,
  note       text,
  PRIMARY KEY (order_ref, line)
);

-- Failure modes that can be switched on, each until a given time.
CREATE TABLE erp.faults (
  mode  text PRIMARY KEY CHECK (mode IN ('down', 'slow', 'rate_limited', 'response_lost', 'rejects')),
  until timestamptz NOT NULL
);

-- ── Bridge ───────────────────────────────────────────────────────────────────────────────

-- Shopify SKU → ERP item code. The two systems never share codes.
CREATE TABLE bridge.sku_map (
  shopify_sku text PRIMARY KEY,
  erp_code    text NOT NULL
);

CREATE TABLE bridge.orders (
  id               bigserial PRIMARY KEY,
  shopify_order_id bigint NOT NULL UNIQUE,   -- one row per order, however many webhooks arrive
  name             text NOT NULL,            -- the store's order name, e.g. #1001
  payload          jsonb NOT NULL,
  -- received → delivering → delivered, or back to failed until the next try.
  status           text NOT NULL DEFAULT 'received'
                   CHECK (status IN ('received', 'delivering', 'delivered', 'failed')),
  erp_ref          text,
  attempts         integer NOT NULL DEFAULT 0,
  last_error       text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz
);

-- One row per webhook Shopify sent. A repeated X-Shopify-Webhook-Id is a redelivery of the
-- same webhook and is acknowledged without doing anything.
CREATE TABLE bridge.webhooks (
  webhook_id   text PRIMARY KEY,             -- X-Shopify-Webhook-Id
  event_id     text,                         -- X-Shopify-Event-Id, shared by one merchant action
  topic        text NOT NULL,
  shop_domain  text,
  order_id     bigint REFERENCES bridge.orders,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per try at writing an order into the ERP.
CREATE TABLE bridge.attempts (
  id          bigserial PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES bridge.orders,
  number      integer NOT NULL,
  started_at  timestamptz NOT NULL,
  duration_ms integer NOT NULL,
  outcome     text NOT NULL CHECK (outcome IN ('created', 'found_in_erp', 'failed')),
  http_status integer,
  error       text,
  UNIQUE (order_id, number)
);
