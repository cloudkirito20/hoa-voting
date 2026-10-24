> **v2.5.4 integrity fix:** New ballot submissions preserve anonymous expected candidate counts for each position; result reports check them against actual votes. Existing historical ballots remain **unverifiable**, not automatically re-certified. Apply the SQL migration in `supabase/v2.5.4-install-parts/` **before** deploying the Worker update. See `README_INTEGRATION_v2.5.4.md`.

> **v2.5.3 UI refresh:** Simpler mobile-friendly admin and voter interfaces; no SQL changes or voting-security changes. See [UI refresh notes](README_UI_REFRESH_v2.5.3.md).

> **v2.5.2 election modes:** The New election form now defaults to protected Official mode; check **Test election** for a clearly labeled practice election that administrators can delete (with its test votes) after closing. See [v2.5.2 release instructions](README_RELEASE_v2.5.2.md). Voucher-printing features from v2.5.1 are unchanged.

# v2.5 Security, Elections, ELECOM and Voucher Reprinting (2026-10-17)

**Start with `README_RELEASE_v2.5.1.md` before deploying.** This release requires
new Supabase migrations (v2.2, v2.3, v2.4, v2.5 in order) and a separate,
never-rotated (without re-encryption) Cloudflare `VOUCHER_ENCRYPTION_KEY` secret.

**Voucher printing is PRINT ONLY.** It never resets a password. Archived
original temporary credentials may be reprinted for selected voters or all
until each voter changes the temporary password. Changed personal passwords
are not recoverable, and previously issued credentials lacking a secure archive
cannot be recreated from their password hashes. Older print-only notes in
previous documentation do not supersede this limitation.

Voter one-ballot protection is enforced by PostgreSQL's composite primary key
on `voter_participation` and atomic ballot RPC, not by browser state.

---

# HOA Secure Vote — Cloudflare Free + Supabase Free

A responsive HOA officer election website with two separate portals:

- `/` and `/vote` — direct voter login, ballot, review, one-time submission, receipt
- `/admin` — administrator-only login, election setup, voter registration, candidates, results, participation, A4 printing, CSV export

The public login does **not** display an Admin Portal button. Administrators access the admin login only by navigating directly to `/admin`.

## Architecture

- **Cloudflare Workers Free**: hosts the static site and the small API layer.
- **Supabase Free**: PostgreSQL database and database-side password hashing / ballot transaction.
- **No Cloudflare D1 is required.**
- **No Supabase key is shipped to the browser.** The Supabase secret key is stored only as a Cloudflare Worker secret.

The database keeps `voter_participation` separate from anonymous `ballots` / `ballot_votes`. Administrators can see who has voted, including Name, Block and Lot, but the normal application has no voter-to-ballot link showing how a resident voted.

## Features

### Admin Portal

- First-time administrator setup protected by a private `SETUP_TOKEN`
- Create elections
- Draft → Open → Closed election lifecycle
- Delete unused Draft/Open/Closed elections only; elections containing ballots are protected from deletion and audit history is retained
- Only one election can be open at a time
- Add positions
- Configure how many seats/selections each position allows
- Add/remove candidates while the election is still Draft
- Upload/change/remove candidate photos while the election is Draft; photos are shown on the voter ballot and ballot review screen
- Candidate and position configuration is database-locked after voting opens
- Register voters with:
  - Full name
  - Block
  - Lot
  - Random unique username
  - Random 12-character password
- Print/copy newly generated voter credentials
- Reset voter passwords to a new random 12-character password
- Enable/disable voter accounts
- Permanently delete voter accounts that have no voting history; voters who have participated in an election must be disabled instead so turnout and participation records remain intact
- Search voters by name, username, block or lot
- See Voted / Not Voted status
- Election results with vote totals, percentages and turnout
- Participation report with Name, Block, Lot, Username, Voted / Not Voted, and voted timestamp
- Print / Save PDF using an A4 print layout
- CSV export

### Voter Portal

- Username/password login
- Mobile and desktop responsive ballot
- Candidates grouped by position with candidate photos for identity verification
- Enforces the configured maximum selections per position
- Ballot review before submission
- Final confirmation
- One ballot per voter per election enforced in PostgreSQL
- One active voter login session per account; a second device is blocked until the first session logs out or expires
- Submission receipt that does not reveal selections

## Security design

- Voter passwords are generated with `crypto.getRandomValues()` in the Worker.
- Password hashes are generated and verified inside PostgreSQL using `pgcrypto` bcrypt (`crypt` + `gen_salt`).
- Cloudflare sessions use random tokens; only SHA-256 token hashes are stored in Supabase.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`.
- CSRF token required for state-changing authenticated API requests.
- Failed logins are throttled by IP and by IP + account to reduce shared-Wi-Fi lockouts.
- Row Level Security is enabled on application tables.
- `anon` and `authenticated` table access is revoked.
- Privileged database access is available only to the Cloudflare Worker through `SUPABASE_SECRET_KEY`.
- Ballot submission is a PostgreSQL function/transaction so participation, ballot creation and vote rows commit together or roll back together.
- No voter ID or participation ID is stored in the anonymous ballot tables.

> This application helps with election integrity, but software alone cannot certify an election. For a formal HOA election, use appropriate election observers, credential-handling procedures, backups and any rules required by your HOA documents or local law.

---

# Deployment

## 1. Create a Supabase Free project

Create a project at Supabase and wait for the database to become available.

In the project dashboard, obtain:

- **Project URL** — similar to `https://abc123.supabase.co`
- **Secret API key** — preferably the current `sb_secret_...` key

Do **not** put the secret key in `public/app.js`, HTML, GitHub, or any browser code.

## 2. Create the Supabase database schema

Open:

**Supabase Dashboard → SQL Editor → New query**

Copy the entire contents of:

`supabase/schema.sql`

Run it once.

This creates the tables, indexes, RLS configuration, password functions, ballot transaction, and election configuration locks.

## Existing installation update: protected election deletion and bulk voter import

The older `fix-open-election-delete.sql` has been retired. Use
`supabase/upgrade-bulk-voters-and-integrity.sql` instead. The upgraded system
will not delete elections that contain recorded ballots. Existing test elections
with votes must be preserved or handled through a separately authorized,
audited database-retention procedure.

## Existing installation update: candidate photos

For an existing Supabase project, run this migration once before deploying the candidate-photo version of the Worker:

`supabase/add-candidate-photos.sql`

It adds the `candidates.photo_path` column and creates a private Supabase Storage bucket named `candidate-photos`. Existing candidates, ballots, voters, and election results are not changed.

Candidate photos support **JPEG, PNG, and WebP** files up to **5 MB**. The browser never receives a Supabase key or a direct storage URL; the authenticated Cloudflare Worker serves the images from the private bucket.


## 3. Install project dependencies

From the project folder:

```bash
npm install
```

Then sign in to Wrangler if needed:

```bash
npx wrangler login
```

## 4. Add Cloudflare secrets

Run:

```bash
npx wrangler secret put SUPABASE_URL
```

Paste your Supabase project URL.

Then:

```bash
npx wrangler secret put SUPABASE_SECRET_KEY
```

Paste the Supabase **secret** API key.

Then create a long private setup token:

```bash
npx wrangler secret put SETUP_TOKEN
```

Example value format:

`d3V-hoa-setup-Wk9x4uF7pQ2mN8sL6cT1`

Use your own random value. This token is needed only for the first administrator account setup.

## 5. Deploy to Cloudflare

```bash
npm run deploy
```

Wrangler will display a URL similar to:

`https://hoa-voting.YOUR-SUBDOMAIN.workers.dev`

## 6. Create the first administrator

Open:

`https://YOUR-WORKER.workers.dev/admin`

Because no administrator exists yet, the website will show **First-time admin setup**.

Enter:

- Administrator full name
- Administrator username
- Administrator password (10+ characters)
- The `SETUP_TOKEN` you stored in Cloudflare

After the account is created, the setup screen is permanently disabled unless all administrator records are manually removed from Supabase.

## 7. Configure the election

Recommended order:

1. Create the election.
2. Add every officer position.
3. Enter the number of seats/selections for each position.
4. Add all candidates and upload a clear photo for each candidate.
5. Register voters with Name, Block and Lot.
6. Print/distribute generated voter credentials privately.
7. Test with sample accounts.
8. Open the election.
9. Monitor turnout from Admin → Results & Reports.
10. Close the election when voting ends.
11. Print/Save the final A4 Results report and Participation report.

---

# Local development

Copy `.dev.vars.example` to `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
```

Fill in your real Supabase URL, Supabase secret key, and a setup token.

Then run:

```bash
npm install
npm run dev
```

Open the local URL printed by Wrangler.

Never commit `.dev.vars`.

---

## Single-device voter login

For election security, voter accounts are limited to one active login session at a time. If the same voter tries to sign in from a second phone, computer, browser, or private window while the first session is still active, the second login is rejected and asks the voter to log out from the first device.

The rule is enforced in both the Cloudflare Worker and PostgreSQL. The PostgreSQL trigger locks the voter account row during session creation, so simultaneous login requests cannot both succeed. Admin accounts are not restricted by this rule.

If a voter closes the browser without logging out and later cannot access the original device, the session expires automatically. An administrator can also reset that voter's password, which clears the voter's active sessions.

# A4 reports

In Admin → Results & Reports:

- Choose the election.
- Select **Election Results** or **Voter Participation**.
- Click **Print / Save PDF (A4)**.
- In the browser print dialog, choose A4 paper.
- Choose a physical printer or **Save as PDF**.

The participation report includes:

- Resident Name
- Block
- Lot
- Username
- Voted / Not Voted
- Voted timestamp

It does not show the resident's candidate selections.

---

# Free-plan notes

This version was specifically arranged to work without Cloudflare D1 or a paid Cloudflare Worker plan. The expensive password hash is performed in Supabase PostgreSQL rather than inside the Worker.

Cloudflare Workers Free currently has a small per-request CPU allowance, while waiting for external `fetch()`/database calls does not count as Worker CPU time. The application keeps Worker work intentionally lightweight.

Supabase Free is suitable for a small HOA election, but Free projects may pause after a period of inactivity. Several days before a real election, open the Supabase dashboard and test the website so you know the project is active.

## Suggested pre-election checklist

- Confirm Supabase project is active.
- Confirm `/api/health` returns `{"ok":true,"database":"supabase"}`.
- Test one admin login.
- Test one disposable voter account from registration through ballot submission.
- Confirm the test voter appears as Voted in the participation report.
- Confirm a second submission is rejected.
- Confirm candidate results update.
- Print a test A4 results report.
- Remove/reset any disposable test data before the official election.
- Export/record the final results immediately after closing the election.

---

# Project files

```text
hoa-voting-cloudflare-supabase/
├── .dev.vars.example
├── .gitignore
├── package.json
├── wrangler.jsonc
├── README.md
├── public/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── src/
│   └── index.js
└── supabase/
    ├── schema.sql
    ├── fix-open-election-delete.sql
    └── add-candidate-photos.sql
```

## Current Supabase key guidance

Supabase's newer API key format uses a publishable key for browser code and a secret key for trusted backend code. This project deliberately uses only the backend secret key and never exposes a Supabase key in the browser.

Official references:

- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/api/creating-routes
- https://developers.cloudflare.com/workers/platform/limits/

## Deleting unused elections

Admin > Election Setup can delete a Draft, Open, or Closed election only if it
contains **no submitted ballots**. Deleting a populated election is blocked to
protect voter participation and vote records. Audit log history is preserved.

---

# v2.1 Audit & Upgrade: Bulk voter import and private A4 vouchers

**This upgrade provides bulk import, stronger one-time voter passwords, A4 vouchers, and additional election-integrity safeguards.**

## Required database migration (before deploying the upgraded Worker)

1. Back up the live Supabase database and source files.
2. Check for duplicate unit accounts already in the database:

   ```sql
   select lower(trim(block)) as block, lower(trim(lot)) as lot, count(*)
   from public.users
   where role='voter'
   group by 1,2
   having count(*) > 1;
   ```

   Resolve any duplicates before running the migration. Do not delete a user who
   already participated; reconcile account eligibility with the election committee.
3. In Supabase SQL Editor, run `supabase/upgrade-bulk-voters-and-integrity.sql`
   **one time**. For a brand-new database, the updated `supabase/schema.sql` already includes
   the upgrade. It is safe to re-run the standalone upgrade after a successful installation.
4. Deploy the new Worker and browser assets with `npm install` and `npm run deploy`.
5. Test 1-2 fake voters before importing actual voter credentials.

**Migration effects**: Uniqueness is enforced for voters by normalized Block and
Lot, including inactive accounts. This assumes **one account per eligible unit**;
the HOA must first confirm whether an owner with multiple units can cast multiple
votes. The migration also removes the precise timestamp from anonymous ballot
rows, including historical stored timestamps, to prevent exact-timestamp linkage
with participation records. Participation timestamps are retained. It aggregates vote totals in PostgreSQL to avoid truncated counting. It prevents
website deletion of elections that have received ballots and retains election
audit entries when unused elections are deleted. It locks new voter registration
while an election is open and locks the election row during ballot submission.

Do not run the older `fix-open-election-delete.sql` after applying v2.1, since that
older script was designed for test-election deletion; v2.1 supersedes it.

## How to bulk-register the homeowners

1. Open the accompanying `HOA_Voter_Review.xlsx` and resolve the highlighted
   entries. **The July 2026 housing turnover roster is not an approved voter roll.**
   HOA election officials must confirm eligibility, proxies, and the voting unit.
2. In Excel choose the `Voters - Review` sheet, mark eligible entries with
   `YES` in `approved`, and **Save As -> CSV UTF-8 (Comma delimited)**. Alternatively
   edit the accompanying `HOA_Voter_Staging.csv` directly and save it as UTF-8.
   The web app imports CSV, not `.xlsx` directly.
3. Log in as administrator and visit **Voter Registration**.
4. Under **Bulk Registration + A4 Vouchers**, select the CSV. The app checks
   malformed rows, duplicates in the CSV, existing accounts and repeated owners.
   Review all warnings; the app will not preselect problematic records.
5. Select the verified rows, tick the eligibility confirmation, and click
   **Generate accounts + vouchers**. The browser sends groups of up to 20 voters.
   Each group is one PostgreSQL transaction; on a failure, prior successful groups
   remain registered. Reconcile and retry only missing units.
6. Click **Print vouchers on A4** immediately. Every A4 portrait page fits 8
   cut-out vouchers (2 columns x 4 rows), each showing homeowner, Block, Lot,
   username, random 12-character password, and the correct login URL.
   Browser print settings: A4, portrait, scale 100%, no headers/footers.
7. Hand out the private slips directly to their authorized residents; retain no
   unencrypted master list and shred any spoiled printouts.

**One-time password printing:** only bcrypt hashes are stored in Supabase. The
admin browser receives working passwords once, immediately after registration.
If a page is reloaded before printing, passwords cannot be retrieved. Use the
existing password reset action on the affected voter and print the replacement.
Bulk printing is not available retroactively for previously registered accounts.

## Election integrity caveats / further recommendations

- Do a supervised mock election before deploying for the real ballot. No live
  Supabase account or production election was available to test here.
- Administrators can still access live candidate vote counts in Results & Reports;
  consider restricting tallies until polls close to avoid influencing voting.
- Eligibility denominator in old reports is based on currently active accounts;
  snapshot the certified voter roll when opening a formal election for accurate
  historical turnout and stronger protection against mid-election account changes.
- Raw database operators and backups can still have metadata/logs capable of
  correlating transactions. Removing exact ballot timestamps greatly reduces
  one direct link, but it is **not proof of cryptographic ballot anonymity**.
- Use individual administrator accounts, protected with MFA on Cloudflare and
  Supabase, least-privilege access, private distribution of vouchers, and
  independent election observers.
- Verify HOA bylaws, COMELEC / DHSUD or other applicable regulations with the
  HOA's counsel before official use. This is a software audit, not certification.
