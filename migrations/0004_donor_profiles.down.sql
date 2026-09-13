DROP TABLE IF EXISTS shortlists;
DROP TABLE IF EXISTS anonymity_preferences;
DROP TRIGGER IF EXISTS trg_donor_profiles_updated_at ON donor_profiles;
DROP TABLE IF EXISTS donor_profiles;
DROP TYPE IF EXISTS profile_status;
DROP TYPE IF EXISTS screening_status;
