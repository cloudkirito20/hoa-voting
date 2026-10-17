HOA v2.5 install: BACK UP Supabase and test on staging before installing on Production.
Install v2.2, v2.3 and v2.4 migrations first, in their numbered order.
Run each complete v2.5 SQL file 01, 02, 03, 04, then read-only 05 in Supabase SQL Editor.
Then add Cloudflare Production secret VOUCHER_ENCRYPTION_KEY: an independent random 32-byte key as exactly 64 hex characters.
PowerShell example (print it only into Clipboard):
$bytes = New-Object byte[] 32; $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose(); [BitConverter]::ToString($bytes).Replace('-', '') | Set-Clipboard
Do NOT reuse SETUP_TOKEN or SUPABASE_SECRET_KEY. Never share or commit this encryption key. Back up the key offline in a secure password manager: losing it makes the archived vouchers unrecoverable.
Reprint does NOT rotate passwords. Already-changed personal passwords are NOT stored. Existing accounts created before the archive is installed cannot have old passwords recovered: use any securely saved original vouchers, or distribute a new credential only if the member explicitly requests a separate password reset.
