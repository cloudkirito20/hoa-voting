# HOA first-time admin setup - token autofill fix (v2.1.1)

## What changed

- First-time administrator registration now collects the admin login details and Cloudflare `SETUP_TOKEN` on two different screens.
- The token screen explicitly distinguishes the token from the admin password and shows the number of characters entered **without revealing the token**.
- An optional **Paste setup token from clipboard** button lets the user paste intentionally with one click. The browser may request clipboard permission; `Ctrl+V` still works.
- The form detects accidental reuse/autofill of the admin password in the token field.
- On first-time setup, the app checks `/api/bootstrap-status` before `/api/me`, avoiding a misleading unauthenticated 401 on the setup screen.
- The backend's token comparison, SQL schema, election and ballot functions are unchanged.
- `index.html` loads `/app.js?v=2.1.1` to make the new frontend easier to verify after deployment.

## Publish through the existing GitHub -> Cloudflare connection

1. Back up your GitHub repository or make a new branch for this change.
2. Replace `public/app.js` and `public/index.html` in the repository with the copies in this package (and, if desired, `tests/smoke.mjs`, `package.json`, and `package-lock.json`). Do **not** copy `.git` or `node_modules` from your local directory into the repository.
3. Run `npm test` and `npm run check` from the project root if you have Node.js available.
4. Commit your changes to the **branch Cloudflare builds from**. If automatic builds are enabled, wait for Cloudflare Workers -> Deployments to show a successful new Production deployment.
5. Open the same deployed Worker URL in a private browser window, hard-refresh, and confirm the admin setup shows **Step 1 of 2** and **Continue to setup token**. If you still see both password fields on one screen, the updated frontend has not been deployed.
6. Complete Step 1, then on the Step 2 token screen click **Paste setup token from clipboard**. It should show `64 characters entered` if your PowerShell-generated token is 64 characters.
7. If the backend still responds `Invalid setup token.` with a 64-character input, the active Production Worker secret differs. Confirm the selected Worker (`hoa-voting`), Production environment, and deployed secret using Cloudflare settings. **Do not publish, log, screenshot or send the token**. A valid 64-character length alone does not prove a match.

### Important

This patch does not change production secrets and does not install itself into GitHub or Cloudflare. It does not bypass token verification. No Supabase SQL migration is needed for this patch.
