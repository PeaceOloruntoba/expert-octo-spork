/**
 * Seeds a minimal but useful dataset for local development / demos:
 *  - 3 jurisdictions with different compensation caps (exercises the rules engine)
 *  - 1 demo clinic + 1 clinic-staff user
 *  - 1 admin user, 1 donor user (with a profile ready to publish), 1 recipient user
 *
 * Run with: npm run seed
 * Safe to re-run: uses ON CONFLICT / existence checks throughout.
 */
import { pool, query } from '../src/db/pool';
import { hashPassword } from '../src/utils/password';

const DEMO_PASSWORD = 'DemoPass123!';

async function seedJurisdictions() {
  const rows = [
    { code: 'US-CA', name: 'United States - California', minAge: 21, cap: 1000000, currency: 'USD' },
    { code: 'US-NY', name: 'United States - New York', minAge: 21, cap: 800000, currency: 'USD' },
    { code: 'UK', name: 'United Kingdom', minAge: 18, cap: 0, currency: 'GBP' }, // altruistic-only jurisdiction example
  ];
  for (const r of rows) {
    await query(
      `INSERT INTO jurisdictions (code, name, min_age, compensation_cap_minor_units, currency)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO NOTHING`,
      [r.code, r.name, r.minAge, r.cap, r.currency]
    );
  }
  console.log('Seeded jurisdictions.');
}

async function seedUser(email: string, role: string, jurisdiction: string) {
  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rowCount) return existing.rows[0].id as string;

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const result = await query(
    `INSERT INTO users (email, password_hash, role, jurisdiction_code, email_verified_at)
     VALUES ($1, $2, $3, $4, now()) RETURNING id`,
    [email, passwordHash, role, jurisdiction]
  );
  return result.rows[0].id as string;
}

async function seedDemoAccounts() {
  const adminId = await seedUser('admin@demo.local', 'admin', 'US-CA');
  const donorId = await seedUser('donor@demo.local', 'donor', 'US-CA');
  const recipientId = await seedUser('recipient@demo.local', 'recipient', 'US-CA');
  const clinicStaffId = await seedUser('clinic@demo.local', 'clinic_staff', 'US-CA');
  const ethicsId = await seedUser('ethics@demo.local', 'ethics_reviewer', 'US-CA');

  await query(`INSERT INTO donor_profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [donorId]);

  const clinic = await query('SELECT id FROM clinics WHERE name = $1', ['Demo Fertility Clinic']);
  const clinicId =
    clinic.rows[0]?.id ??
    (await query(`INSERT INTO clinics (name, jurisdiction_code) VALUES ($1, $2) RETURNING id`, ['Demo Fertility Clinic', 'US-CA']))
      .rows[0].id;

  await query(
    `INSERT INTO clinic_staff (user_id, clinic_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
    [clinicStaffId, clinicId]
  );

  const donorProfile = await query('SELECT id FROM donor_profiles WHERE user_id = $1', [donorId]);
  await query(
    `INSERT INTO clinic_assignments (clinic_id, donor_id) VALUES ($1, $2) ON CONFLICT (clinic_id, donor_id) DO NOTHING`,
    [clinicId, donorProfile.rows[0].id]
  );

  console.log('Seeded demo accounts (all use password:', DEMO_PASSWORD, ')');
  console.log({ adminId, donorId, recipientId, clinicStaffId, ethicsId, clinicId });
}

async function seedLegalAgreement() {
  const existing = await query(
    `SELECT id FROM legal_agreements WHERE jurisdiction_code = 'US-CA' AND agreement_type = 'donor_recipient_terms'`
  );
  if (existing.rowCount) return;
  await query(
    `INSERT INTO legal_agreements (jurisdiction_code, agreement_type, version, title, content)
     VALUES ('US-CA', 'donor_recipient_terms', 1, 'Donor-Recipient Agreement (US-CA)', 'Placeholder legal text — replace with counsel-reviewed agreement text per jurisdiction before launch.')`
  );
  console.log('Seeded a placeholder legal agreement for US-CA.');
}

async function main() {
  await seedJurisdictions();
  await seedDemoAccounts();
  await seedLegalAgreement();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
