-- Donor profile builder + status trackers (PRD 4.1, DM-1)
CREATE TYPE screening_status AS ENUM ('not_started', 'in_review', 'eligible', 'not_eligible', 'needs_more_info');
CREATE TYPE profile_status AS ENUM ('incomplete', 'ready', 'published', 'suspended');

CREATE TABLE donor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  headline TEXT,
  bio TEXT,
  -- Freeform, donor-editable attributes (height, eye color, education, etc.)
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Per-attribute visibility toggles; only keys set `true` are ever exposed to recipients (DM-1)
  visibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  screening_status screening_status NOT NULL DEFAULT 'not_started',
  profile_status profile_status NOT NULL DEFAULT 'incomplete',
  view_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_donor_profiles_updated_at
BEFORE UPDATE ON donor_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_donor_profiles_status ON donor_profiles(profile_status);

CREATE TABLE anonymity_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id UUID NOT NULL REFERENCES donor_profiles(id) ON DELETE CASCADE,
  preference TEXT NOT NULL, -- 'anonymous' | 'known' | 'open_to_future_contact'
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anonymity_preferences_donor ON anonymity_preferences(donor_id);

CREATE TABLE shortlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  donor_id UUID NOT NULL REFERENCES donor_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, donor_id)
);
