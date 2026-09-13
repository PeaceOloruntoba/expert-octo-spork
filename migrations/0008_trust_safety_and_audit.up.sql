-- Trust & Safety / Fraud Detection (TS-1..TS-3) + Admin Console (AD-1..AD-3)
CREATE TABLE trust_safety_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL, -- 'profile' | 'message' | 'conversation'
  subject_id UUID NOT NULL,
  flagged_by UUID REFERENCES users(id), -- null = automated system flag
  reason TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'low', -- low | medium | high
  status TEXT NOT NULL DEFAULT 'open', -- open | dismissed | actioned
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trust_safety_flags_status ON trust_safety_flags(status);

CREATE TABLE profile_suspensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id UUID NOT NULL REFERENCES donor_profiles(id),
  suspended_by UUID NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  suspended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reinstated_at TIMESTAMPTZ
);

-- Append-only audit log (AD-3, and required across identity/medical/financial reads+writes)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
