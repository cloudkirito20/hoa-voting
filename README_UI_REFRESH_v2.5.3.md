# Casa Verde de Bañaderos HOA — v2.5.3 UI Refresh

**Release type:** User-interface refinement on top of the supplied v2.5.2 project.

**Status:** Source code and offline-browser mock tests completed. NOT deployed to the user's Cloudflare Worker, NOT validated with production Supabase or real ballots. Test in staging before a live election.

## Design goals

Make the site easy for infrequent HOA administrators and first-time voters to use while retaining the working election controls, privacy safeguards, and secure ballot submission.

## What changed

| Area | Before | v2.5.3 |
|---|---|---|
| Overall presentation | Dense controls and small labels across screens | Unified dark-green/neutral visual system, consistent spacing, restrained cards, clear page headings |
| Admin navigation | Plain stacked links; mobile needed sideways navigation | Four familiar icon-and-label sections; mobile uses a compact four-item navigation grid |
| Dashboard | Four counters and a simple recent-election list | Same counters plus three concise, clickable setup steps and clearer election states |
| Election setup | Dense detail panel and many competing controls | Guided Create → Add candidates → Open sequence; focused election selector; compact schedule; ELECOM/deletion tucked into explicit sections |
| New election | Long single modal with mixed explanations | Concise form, clearly visible optional TEST checkbox, OFFICIAL by default, PHT schedule labeling |
| Voter directory | Several sensitive buttons repeated in every row | Readable directory, per-homeowner Manage menu, search and election filter, mobile stacked cards |
| Voucher printing | Many competing options across the page | Primary print-all-vouchers action; selected/QR-only options grouped; replacement credentials in a caution-labeled expansion |
| CSV importer | Always-on technical panel | Optional expandable panel, still keeping preview and eligibility review before import |
| Reports | Many competing print buttons | Results/Participation view switch and primary final A4 action; additional exports behind an expansion; explains when final printing is available |
| Voter ballot | Selection cap explained as static text | Two-step progress labels, per-position live selection count, touch-friendly candidates, clearer final-review step; mobile footer no longer overlays candidates |
| Dialog interaction | Minimal dialog keyboard treatment | Dialog role, keyboard Escape, bounded Tab navigation, focus restoration; enhanced focus visibility and reduced-motion support |

## Preservation / behavior boundaries

- **No database migration in v2.5.3.** The already-verified v2.5.2 Official/Test `is_test` column and guarded deletion RPC remain required.
- `src/index.js`, all `supabase/` migration files, Cron schedule, QR voucher A4 printing logic, credential-archive behavior, election status rules, and atomic vote submission are unchanged.
- **TEST vs OFFICIAL:** Unchecked checkbox remains OFFICIAL, non-deletable. Checked is TEST and can be removed only through the existing protected admin workflow when voting is not open.
- Voter login, mandatory first-login password change, one-vote-per-account enforcement, and cryptographic storage remain server/database controlled.
- No real credentials, Supabase secrets, voter accounts, or election votes are packaged in the source ZIP. Sample browser screenshots used synthetic records only.

## Test evidence

1. `npm run check` succeeded (Worker and frontend JavaScript parsing).
2. `npm test` succeeded across **seven** suites: smoke, security, deadline, voucher archive, legacy voucher, election modes, and UI.
3. Offline Chromium mock-data walkthrough succeeded at **1440×900** and **390×844** screen sizes: admin overview, election selector, Create Election modal, voter directory, optional CSV import, reports, voter ballot choices, confirm-before-submitting modal, and receipt screen.
4. No browser JavaScript errors and no document-wide horizontal overflow in tested admin, report, or ballot views.

**Important limitation:** These are offline tests against synthetic API responses. They do not validate live Supabase access, Cloudflare release readiness, browser print dialogs on user devices, database transaction races, or assistive-technology certification.

## Installation on staging and production

1. Back up the existing GitHub repository and database. Keep live voting paused during upgrades.
2. Unzip this release and replace project source files on your staging branch, **preserving the existing folder structure**. The archive deliberately excludes `.git/`, `node_modules/`, and local `.dev.vars` secrets.
3. In the project directory run `npm ci`, `npm run check`, and `npm test`.
4. Deploy staging using your Cloudflare Workers workflow. Confirm your existing `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SETUP_TOKEN`, and `VOUCHER_ENCRYPTION_KEY` remain in Cloudflare secrets and are **not** committed.
5. Test admin navigation, creation of **both** election types, permanent protection of OFFICIAL elections, the controlled TEST deletion flow, voter voucher printing, first-login password change, ballot review, and final-report printing in staging using synthetic voters.
6. Publish the same tested commit through the GitHub branch connected to Cloudflare production. Check Worker Deployments and the one-minute Cron schedule, and conduct a production smoke test on non-live mock data.

**Suggested commit title:** `UI refresh v2.5.3: simplify HOA admin and voter experience`
