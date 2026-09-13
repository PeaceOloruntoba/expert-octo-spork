-- Jurisdiction & Eligibility Rules Engine (JE-1, JE-2, JE-3)
CREATE TABLE jurisdictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  min_age INT NOT NULL DEFAULT 18,
  compensation_cap_minor_units BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  anonymity_law JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_jurisdictions_updated_at
BEFORE UPDATE ON jurisdictions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ethics_review_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL, -- 'profile' | 'match' | 'transaction'
  subject_id UUID NOT NULL,
  triggering_rule TEXT NOT NULL,
  jurisdiction_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  decided_by UUID REFERENCES users(id),
  decision_notes TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
