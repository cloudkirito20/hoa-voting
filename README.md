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
- Permanently delete Draft/Closed test elections and all related test ballots/results (Open elections must be closed first)
- Only one election can be open at a time
- Add positions
- Configure how many seats/selections each position allows
- Add/remove candidates while the election is still Draft
- Candidate and position configuration is database-locked after voting opens
- Register voters with:
  - Full name
  - Block
  - Lot
  - Random unique username
  - Random 8-character password
- Print/copy newly generated voter credentials
- Reset voter passwords to a new random 8-character password
- Enable/disable voter accounts
- Search voters by name, username, block or lot
- See Voted / Not Voted status
- Election results with vote totals, percentages and turnout
- Participation report with Name, Block, Lot, Username, Voted / Not Voted, and voted timestamp
- Print / Save PDF using an A4 print layout
- CSV export

### Voter Portal

- Username/password login
- Mobile and desktop responsive ballot
- Candidates grouped by position
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
- Failed logins are throttled by IP.
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
4. Add all candidates.
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
    └── schema.sql
```

## Current Supabase key guidance

Supabase's newer API key format uses a publishable key for browser code and a secret key for trusted backend code. This project deliberately uses only the backend secret key and never exposes a Supabase key in the browser.

Official references:

- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/guides/api/creating-routes
- https://developers.cloudflare.com/workers/platform/limits/

## Deleting a test election

In **Admin → Election Setup**, select a Draft or Closed test election and choose **Delete election**. The admin must type the exact election title before permanent deletion is enabled. Open elections cannot be deleted; close voting first. Deletion removes the election, positions, candidates, participation records, ballots, vote totals, and election-scoped audit entries so the test run does not remain in election reports/history.

If this feature is being added to an already-created Supabase project, run the updated `supabase/schema.sql` once in Supabase SQL Editor before deploying the updated Worker. The schema is written with `create or replace`/`if not exists` statements so it can be rerun safely for this update.

## Deleting test elections

Admin → Election Setup now shows **Delete election** for Draft, Open, and Closed elections. Deleting an Open election stops voting immediately and permanently removes that election's positions, candidates, participation rows, ballots, vote totals, and election-specific test history. Registered voter accounts are kept. The administrator must type the exact election title to confirm permanent deletion.
