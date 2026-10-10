-- Actions taken from the public console, to keep the demo within its limits. The visitor is
-- stored only as a salted hash of their IP address, never the address itself.
CREATE TABLE bridge.demo_actions (
  id     bigserial PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('order', 'fault', 'replay')),
  client text NOT NULL,
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON bridge.demo_actions (action, at);
