-- Stock flows from the ERP to the store. The ERP has no webhooks (like many real ones), so the
-- bridge polls it with a cursor: every change to an item's stock gives it a higher version, and
-- the bridge asks for everything above the last version it pushed.

CREATE SEQUENCE erp.stock_version;
ALTER TABLE erp.items ADD COLUMN version bigint NOT NULL DEFAULT nextval('erp.stock_version');
CREATE INDEX ON erp.items (version);

CREATE FUNCTION erp.bump_stock_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stock IS DISTINCT FROM OLD.stock THEN
    NEW.version := nextval('erp.stock_version');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER items_stock_version BEFORE UPDATE ON erp.items
  FOR EACH ROW EXECUTE FUNCTION erp.bump_stock_version();

-- Stock moves booked in the ERP outside orders (deliveries from the roastery, counts).
CREATE TABLE erp.stock_adjustments (
  id         bigserial PRIMARY KEY,
  item_code  text NOT NULL REFERENCES erp.items,
  delta      integer NOT NULL,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The store's ID for each SKU's inventory item, looked up once.
ALTER TABLE bridge.sku_map ADD COLUMN inventory_item_id text;

-- Small pieces of state: the stock cursor, the store's location.
CREATE TABLE bridge.state (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every quantity the bridge set in the store, and why.
CREATE TABLE bridge.stock_pushes (
  id        bigserial PRIMARY KEY,
  sku       text NOT NULL,
  quantity  integer NOT NULL,
  previous  integer,                        -- what the store had, when known
  source    text NOT NULL CHECK (source IN ('sync', 'reconcile')),
  pushed_at timestamptz NOT NULL DEFAULT now()
);

-- One row per nightly reconciliation.
CREATE TABLE bridge.reconciliations (
  id             bigserial PRIMARY KEY,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  orders_checked integer,
  orders_missing integer,                   -- in the store but never received by the bridge
  stock_checked  integer,
  stock_fixed    integer,                   -- variants whose store quantity was corrected
  details        jsonb,
  error          text
);
