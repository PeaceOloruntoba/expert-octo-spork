-- Transactions & Compensation (TX-1..TX-4) + Dispute & Refund Handling (DR-1..DR-3)
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users(id),
  donor_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id),
  amount_minor_units BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  jurisdiction_cap_minor_units BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created', -- created | funded | released | refunded | disputed
  -- Never store raw card details (TX-4) — only a tokenized reference from the provider.
  payment_provider_token TEXT,
  provider TEXT NOT NULL DEFAULT 'mock-escrow',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE escrow_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_minor_units BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | confirmed | released
  confirmed_by UUID REFERENCES users(id),
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_escrow_milestones_transaction ON escrow_milestones(transaction_id);

CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filed_by UUID NOT NULL REFERENCES users(id),
  transaction_id UUID REFERENCES transactions(id),
  conversation_id UUID REFERENCES conversations(id),
  reason_category TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | under_review | resolved
  resolved_by UUID REFERENCES users(id),
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_disputes_status ON disputes(status);
