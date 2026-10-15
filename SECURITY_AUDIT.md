# HOA Secure Vote - Code and Roster Audit (2026-10-16)

**Scope:** offline review and modification of the supplied Cloudflare Worker +
Supabase source archive and the 3-page homeowner PDF dated 2026-07-30.
**Limitations:** no access to the deployed Cloudflare account, live Supabase
schema, live voter database, infrastructure logs, production login, or live
ballots. SQL was inspected but not executed against Supabase; JS syntax and
local smoke checks were run. Do not interpret this as an independent security
certification or official election certification.

## Safeguards that were present before this upgrade

- Random session tokens stored in database as SHA-256 hashes, HttpOnly Secure
  SameSite=Strict cookies, CSRF tokens for authenticated mutations.
- Bcrypt password hashes generated/verified in PostgreSQL, not sent to browsers.
- `hoa_submit_ballot` database transaction with unique participation key prevents
  a second ballot for the **same voter account and election**.
- Separate participation and ballot-vote tables (though timestamps originally
  permitted a link as explained below).
- Database RLS and no direct anonymous/authenticated table privileges;
  privileged Supabase API key is a Worker secret, not an asset.
- Election positions/candidates locked once polls open; one-device voter sessions.

## Issues identified, changes implemented

| Importance | Original issue | New behavior | Deployment requirement |
|---|---|---|---|
| Critical: ballot privacy | `ballots.submitted_at` and `voter_participation.voted_at` could have matching transaction timestamps, allowing inference of voter ballot by comparing DB rows | Migration removes precise anonymous-ballot timestamp (including historical values) | Run the SQL upgrade after backups |
| Critical: destruction of election record | Previous `hoa_delete_election` allowed deletion of a voted election and its audit entries | SQL now refuses deletion if ballot/participation exists; audit history preserved | Run the SQL upgrade; do not restore retired migration |
| High: duplicate accounts | No database uniqueness on voters' Block/Lot; a unit could be registered twice and cast ballots from two accounts | Unique voter Block/Lot index; browser preview detects duplicate CSV rows and existing accounts | Confirm voting policy and resolve existing duplicate records before migration |
| High: vote total undercount | Previous results API fetched individual ballot_votes records; Supabase's default row cap can silently truncate large multi-seat elections | New `hoa_candidate_vote_totals` SQL RPC aggregates counts in PostgreSQL | Run the SQL upgrade |
| High: roster changes during vote | Registration permitted while an election was open | New account creation, account re-enablement, and deletion blocked during open elections; password resets/emergency disable remain available | Worker deployment + SQL upgrade |
| Medium: vote/close race | Open-status check and vote insertion lacked an election-row lock | SQL function locks election with `FOR SHARE` so close cannot commit between the check and vote insertion | Run the SQL upgrade |
| Medium: bulk import missing | Admin created each voter individually | Admin CSV staging preview, existing/within-file duplicate checks, required eligibility confirmation, sequential batches of 20, one SQL transaction per batch | Deploy new Worker and assets; install SQL upgrade |
| Medium: password issuance | New voter password was 8 characters | 12-character cryptographically random password and one-time A4 print view | Deploy Worker and browser assets |
| Medium: communal IP lockout | Ten wrong logins behind one IP blocked all residents sharing that IP for 15 minutes | 8 per IP/account and up to 80 per IP; legacy cleanup retained | Deploy Worker |
| Medium: spreadsheet formula injection | User-derived result CSV exports could open as Excel formula cells | Dangerous leading CSV formula characters escaped in download function | Deploy browser assets |

## Roster reconciliation

Source: `LIST-OF-HOA-AS-OF-7-30-2026.pdf` (3 pages).

- 156 physical populated table rows plus one merged row containing two
  homeowners, yielding **157 homeowner entries** when separated.
- Three records each cover two lots (Blocks 1, 3, and 4); expanding those
  records results in **160 Block/Lot listings**.
- Block 3, Lot 3 is listed twice for the same homeowner, so there are **159
  distinct Block/Lot identifiers**, consistent with the source PDF's stated
  `TOTAL - 159 HOMES`.
- Block 4, Lot 29 appears on a visually separate line with missing status,
  email and turnover date. Its owner name was checked against the PDF image.
- Several entries are second owners, converted/in-house statuses, or the same
  named owner across different lots. Voting eligibility and the number of
  votes per owner must be decided by the HOA committee, **not** inferred
  from this turnover document.
- The provided `HOA_Voter_Review.xlsx` includes 160 source listing rows with
  a blank approval column and 48 rows on a separate attention sheet (including
  contact-data quality problems). The CSV intentionally has no passwords.

## High-priority follow-on work (not implemented)

1. **Snapshot certified eligible voters per election.** Current election turnout
   denominators use active voter accounts *now* rather than an immutable
   election-opening voter roll. An emergency disable can change the denominator
   during/after voting. Add an approved elector snapshot and reference it in
   both ballot validation and results.
2. **Limit disclosure of candidate tallies during polls.** Admins can currently
   view vote counts before polls close. Implement a closed-election-only result
   policy if required by election procedures.
3. **Strengthen administrator authentication.** Add MFA or an external identity
   layer for all admins and protected recovery rules; protect Cloudflare/Supabase
   admin accounts with MFA, restrict service-role access and rotate secrets.
4. **Prove ballot secrecy and verifiability at a higher assurance level.** No
   source-level patch fully prevents a trusted database operator or logs/backups
   from correlating transactions. An independent election security review is
   needed before claiming ballot anonymity, coercion resistance, or verifiability.
5. **Add live integration and failure tests.** Verify SQL migrations on a restored
   Supabase test database, test import timeout behavior, two concurrent account
   creations for the same lot, concurrent vote/close, 1,000+ selections, login
   rate limits behind one IP, mobile printing and account recovery.

## Operational roll-out sequence

1. Back up Supabase; never apply a schema migration first on the live election
   without testing a restored copy.
2. Confirm the HOA's voting unit policy (one vote per lot vs one per owner,
   treatment of proxies, joint ownership and second-owner records).
3. Reconcile duplicate/multi-lot entries in the reviewed roster.
4. Apply the upgraded SQL to a test database; reconcile any failed unique-index
   creation rather than deleting voter records with history.
5. Deploy the new Worker/assets, create two demo voter accounts via CSV, print
   vouchers, test their logins from phones and test one ballot submission.
6. Verify single-vote protection, non-leakage of ballot selections in the
   participation report, correct result totals, and no deletion of cast ballots.
7. Conduct a supervised rehearsal and print all real vouchers at the end of
   the approved bulk import before leaving the browser page.

**Credentials are not pre-generated in the XLSX/CSV/PDF files.** They are
created by the live application's SQL function only after administrators approve
and register the voters. The sample voucher PDF is demonstration-only.
