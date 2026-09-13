-- Clinic Partner Portal (CP-1..CP-3) + Medical & Genetic Screening (MG-1..MG-4)
CREATE TABLE clinics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  jurisdiction_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clinic_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clinic_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES donor_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, donor_id)
);

CREATE TABLE screening_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id UUID NOT NULL REFERENCES donor_profiles(id) ON DELETE CASCADE,
  clinic_id UUID REFERENCES clinics(id),
  -- Medical/genetic intake. In production this column sits behind field-level
  -- encryption + break-glass access controls per Architecture v2, Boundary C.
  intake JSONB NOT NULL,
  lab_results JSONB NOT NULL DEFAULT '{}'::jsonb, -- populated by mock genetic-lab integration
  determination TEXT, -- 'eligible' | 'not_eligible' | 'needs_more_info'
  determined_by UUID REFERENCES users(id),
  determination_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  determined_at TIMESTAMPTZ
);

CREATE INDEX idx_screening_submissions_donor ON screening_submissions(donor_id);
CREATE INDEX idx_screening_submissions_clinic ON screening_submissions(clinic_id);

-- Break-glass access log for raw screening data (MG-4)
CREATE TABLE break_glass_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES users(id),
  screening_submission_id UUID NOT NULL REFERENCES screening_submissions(id),
  reason_code TEXT NOT NULL,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
