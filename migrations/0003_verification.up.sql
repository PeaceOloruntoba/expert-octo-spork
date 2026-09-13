-- Identity Verification & KYC (IV-1..IV-4). Mocked provider in MVP starter.
CREATE TYPE verification_status AS ENUM ('not_started', 'pending', 'verified', 'rejected');

CREATE TABLE identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status verification_status NOT NULL DEFAULT 'not_started',
  provider TEXT NOT NULL DEFAULT 'mock-kyc',
  provider_reference TEXT,
  rejection_reason TEXT,
  resubmission_count INT NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_identity_verifications_updated_at
BEFORE UPDATE ON identity_verifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_identity_verifications_user ON identity_verifications(user_id);
