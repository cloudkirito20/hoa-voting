import { createClient } from "@supabase/supabase-js";

const enc = new TextEncoder();
const SESSION_COOKIE = "hoa_session";
const SESSION_SECONDS = 12 * 60 * 60;
const CANDIDATE_PHOTO_BUCKET = "candidate-photos";
const MAX_CANDIDATE_PHOTO_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        requireConfig(env);
        return await api(request, env, url);
      } catch (error) {
        console.error(error);
        return json({ error: friendlyError(error) }, 500);
      }
    }
    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-frame-options", "DENY");
    headers.set("referrer-policy", "no-referrer");
    headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    headers.set("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    if (url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/vote" || url.pathname.endsWith(".html")) {
      headers.set("cache-control", "no-store");
    }
    return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
  },
  // Cron runs each minute. Votes are rejected at the exact database deadline
  // regardless of whether the cron has executed yet.
  async scheduled(_controller, env) {
    requireConfig(env);
    await closeExpiredElections(env);
  }
};

async function closeExpiredElections(env) {
  const { data, error } = await db(env).rpc("hoa_close_expired_elections");
  assertDb(error);
  return Number(data || 0);
}

function isExpiredElection(election) {
  // A legacy open election without a deadline is not allowed to take ballots.
  return election?.status === "open" &&
    (!election.voting_ends_at || Date.parse(election.voting_ends_at) <= Date.now());
}

function visibleElection(election) {
  return isExpiredElection(election) ? { ...election, status: "closed" } : election;
}

function parseDeadline(value) {
  // Require an explicit timezone in API input (the web form converts PH time
  // to UTC). This avoids browser/server-local timezone confusion.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

function validateTimeframe(body) {
  const votingEndsAt = parseDeadline(body?.votingEndsAt);
  if (!votingEndsAt || Date.parse(votingEndsAt) <= Date.now())
    return { error: "Choose a voting deadline in the future, with a date, time, and timezone." };
  const rawStart = body?.votingStartsAt;
  const votingStartsAt = rawStart == null || rawStart === "" ? null : parseDeadline(rawStart);
  if (rawStart && !votingStartsAt)
    return { error: "Voting start must include a valid date, time, and timezone." };
  if (votingStartsAt && Date.parse(votingStartsAt) >= Date.parse(votingEndsAt))
    return { error: "Voting must end after its earliest opening time." };
  return { voting_starts_at: votingStartsAt, voting_ends_at: votingEndsAt };
}

function db(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "hoa-voting-cloudflare-worker/2.5.2" } }
  });
}

function requireConfig(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SECRET_KEY as Cloudflare secrets.");
}

async function api(request, env, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (path === "/api/health" && method === "GET") return health(env);
  if (path === "/api/bootstrap-status" && method === "GET") return bootstrapStatus(env);
  if (path === "/api/setup" && method === "POST") return setupAdmin(request, env);
  if (path === "/api/auth/login" && method === "POST") return login(request, env);
  if (path === "/api/auth/logout" && method === "POST") return logout(request, env);
  if (path === "/api/me" && method === "GET") return getMe(request, env);

  const auth = await authenticate(request, env);
  if (!auth) return json({ error: "Authentication required." }, 401);

  if (method !== "GET") {
    const csrf = request.headers.get("x-csrf-token");
    if (!csrf || !timingSafeEqual(csrf, auth.csrfToken)) return json({ error: "Invalid security token." }, 403);
  }

  if (path === "/api/voter/change-password" && method === "POST") return changeVoterPassword(request, env, auth);
  if (auth.user.role === "voter" && auth.user.must_change_password) {
    return json({ error: "You must change your initial password before using the voting portal.", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
  }

  if (path === "/api/voter/ballot" && method === "GET") return voterBallot(env, auth.user);
  if (path === "/api/voter/vote" && method === "POST") return submitVote(request, env, auth.user);
  if (/^\/api\/candidates\/\d+\/photo$/.test(path) && method === "GET") return candidatePhoto(env, Number(path.split("/")[3]));

  if (auth.user.role !== "admin") return json({ error: "Administrator access required." }, 403);

  if (path === "/api/admin/overview" && method === "GET") return adminOverview(env);
  if (path === "/api/admin/elections" && method === "GET") return listElections(env);
  if (path === "/api/admin/elections" && method === "POST") return createElection(request, env, auth.user);
  if (/^\/api\/admin\/elections\/\d+$/.test(path) && method === "GET") return getElection(env, Number(path.split("/").pop()));
  if (/^\/api\/admin\/elections\/\d+$/.test(path) && method === "DELETE") return deleteElection(request, env, auth.user, Number(path.split("/").pop()));
  if (/^\/api\/admin\/elections\/\d+\/status$/.test(path) && method === "PUT") return updateElectionStatus(request, env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/elections\/\d+\/schedule$/.test(path) && method === "PUT") return updateElectionSchedule(request, env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/elections\/\d+\/positions$/.test(path) && method === "POST") return addPosition(request, env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/positions\/\d+$/.test(path) && method === "DELETE") return deletePosition(env, auth.user, Number(path.split("/").pop()));
  if (/^\/api\/admin\/positions\/\d+\/candidates$/.test(path) && method === "POST") return addCandidate(request, env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/candidates\/\d+\/photo$/.test(path) && method === "PUT") return updateCandidatePhoto(request, env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/candidates\/\d+\/photo$/.test(path) && method === "DELETE") return removeCandidatePhoto(env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/candidates\/\d+$/.test(path) && method === "DELETE") return deleteCandidate(env, auth.user, Number(path.split("/").pop()));

  if (path === "/api/admin/voters" && method === "GET") return listVoters(env, url);
  if (path === "/api/admin/voters" && method === "POST") return createVoter(request, env, auth.user);
  if (path === "/api/admin/voters/bulk" && method === "POST") return bulkCreateVoters(request, env, auth.user);
  if (path === "/api/admin/vouchers/reprint" && method === "POST") return reprintVouchers(request, env, auth.user);
  if (path === "/api/admin/vouchers/qr-slips" && method === "POST") return printQrSlips(env, auth.user);
  if (path === "/api/admin/vouchers/reissue-legacy" && method === "POST") return reissueLegacyVouchers(request, env, auth.user);
  if (/^\/api\/admin\/voters\/\d+$/.test(path) && method === "DELETE") return deleteVoter(env, auth.user, Number(path.split("/").pop()));
  if (/^\/api\/admin\/voters\/\d+\/reset-password$/.test(path) && method === "POST") return resetVoterPassword(env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/voters\/\d+\/active$/.test(path) && method === "PUT") return toggleVoter(request, env, auth.user, Number(path.split("/")[4]));

  if (/^\/api\/admin\/elections\/\d+\/results$/.test(path) && method === "GET") return electionResults(env, Number(path.split("/")[4]));
  if (/^\/api\/admin\/elections\/\d+\/dhsud-final$/.test(path) && method === "GET") return dhsudFinalElectionReport(env, Number(path.split("/")[4]));
  if (/^\/api\/admin\/elections\/\d+\/committee$/.test(path) && method === "GET") return getCommittee(env, Number(path.split("/")[4]));
  if (/^\/api\/admin\/elections\/\d+\/committee$/.test(path) && method === "PUT") return saveCommittee(request, env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/elections\/\d+\/participation$/.test(path) && method === "GET") return participationReport(env, Number(path.split("/")[4]), url);

  return json({ error: "Not found." }, 404);
}

async function health(env) {
  const sb = db(env);
  const { error } = await sb.from("elections").select("id", { head: true, count: "exact" });
  if (error) return json({ ok: false, database: "unavailable", error: error.message }, 503);
  return json({ ok: true, database: "supabase" });
}

async function bootstrapStatus(env) {
  const sb = db(env);
  const { count, error } = await sb.from("users").select("id", { count: "exact", head: true }).eq("role", "admin");
  assertDb(error);
  return json({ needsSetup: Number(count || 0) === 0 });
}

async function setupAdmin(request, env) {
  const sb = db(env);
  const { count, error: countError } = await sb.from("users").select("id", { count: "exact", head: true }).eq("role", "admin");
  assertDb(countError);
  if (Number(count || 0) > 0) return json({ error: "Administrator is already configured." }, 409);
  if (!env.SETUP_TOKEN) return json({ error: "SETUP_TOKEN secret is not configured in Cloudflare." }, 500);

  const body = await readJson(request);
  if (!body || !timingSafeEqual(String(body.setupToken || ""), String(env.SETUP_TOKEN))) return json({ error: "Invalid setup token." }, 403);
  const fullName = clean(body.fullName, 100);
  const username = clean(body.username, 40);
  const password = String(body.password || "");
  if (!fullName || username.length < 4 || password.length < 10 || enc.encode(password).length > 72) return json({ error: "Provide an admin name, username (4+ characters), and password (10+ characters, at most 72 UTF-8 bytes)." }, 400);

  // PostgreSQL serializes first-admin creation using an advisory transaction
  // lock, closing the parallel-requests race in the read-then-create flow.
  const { error } = await sb.rpc("hoa_bootstrap_admin", {
    p_username: username,
    p_password: password,
    p_full_name: fullName
  });
  if (error) {
    if (/already configured/i.test(error.message || "")) return json({ error: "Administrator is already configured." }, 409);
    if (isUnique(error)) return json({ error: "That administrator username is already in use." }, 409);
    assertDb(error);
  }
  return json({ ok: true });
}

async function login(request, env) {
  const sb = db(env);
  const body = await readJson(request);
  const username = clean(body?.username, 40);
  const password = String(body?.password || "");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!username || !password) return json({ error: "Enter your username and password." }, 400);

  const usernameKey = username.toLowerCase();
  const cutoff15 = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const cutoffDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await sb.from("login_attempts").delete().lt("attempted_at", cutoffDay);
  const [ipRate, userRate] = await Promise.all([
    sb.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("attempted_at", cutoff15),
    sb.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("username", usernameKey).gte("attempted_at", cutoff15)
  ]);
  assertDb(ipRate.error); assertDb(userRate.error);
  // Many neighbors can share a public IP. Use a tight per-IP+account threshold,
  // but allow more collective login errors before blocking an entire HOA network.
  if (Number(ipRate.count || 0) >= 80 || Number(userRate.count || 0) >= 8)
    return json({ error: "Too many failed login attempts. Please try again in 15 minutes." }, 429);

  const { data, error } = await sb.rpc("hoa_verify_login", { p_username: username, p_password: password });
  assertDb(error);
  const user = Array.isArray(data) ? data[0] : data;
  if (!user) {
    const { error: attemptError } = await sb.from("login_attempts").insert({ ip, username: usernameKey });
    assertDb(attemptError);
    return json({ error: "Invalid username or password." }, 401);
  }

  await sb.from("login_attempts").delete().eq("ip", ip).eq("username", usernameKey);
  // hoa_verify_login was deployed before the new flag existed; read it from the
  // canonical user row rather than changing a PostgREST RETURNS TABLE signature.
  if (user.role === "voter") {
    const flag = await sb.from("users").select("must_change_password").eq("id", user.id).single();
    assertDb(flag.error);
    user.must_change_password = Boolean(flag.data?.must_change_password);
  }

  // Voters may have only one active session at a time. Clean up expired sessions first,
  // then perform a friendly pre-check. PostgreSQL also enforces this rule with a trigger
  // so simultaneous login requests cannot bypass it.
  const nowIso = new Date().toISOString();
  const { error: expiryCleanupError } = await sb.from("sessions").delete().eq("user_id", user.id).lte("expires_at", nowIso);
  assertDb(expiryCleanupError);
  if (user.role === "voter") {
    const { count: activeSessions, error: activeSessionError } = await sb.from("sessions")
      .select("token_hash", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gt("expires_at", nowIso);
    assertDb(activeSessionError);
    if (Number(activeSessions || 0) > 0) {
      return json({ error: "This voter account is already signed in on another device. Please log out there first before signing in here." }, 409);
    }
  }

  const token = randomString(48);
  const tokenHash = await sha256(token);
  const csrfToken = randomString(32);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const { error: sessionError } = await sb.from("sessions").insert({ token_hash: tokenHash, user_id: user.id, csrf_token: csrfToken, expires_at: expiresAt });
  if (sessionError) {
    const msg = sessionError.message || "";
    if (user.role === "voter" && /already signed in|another device|active session/i.test(msg)) {
      return json({ error: "This voter account is already signed in on another device. Please log out there first before signing in here." }, 409);
    }
    assertDb(sessionError);
  }

  const headers = secureJsonHeaders();
  headers.append("set-cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`);
  return new Response(JSON.stringify({ ok: true, user: publicUser(user), csrfToken }), { status: 200, headers });
}

async function logout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    const sb = db(env);
    await sb.from("sessions").delete().eq("token_hash", await sha256(token));
  }
  const headers = secureJsonHeaders();
  headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

async function getMe(request, env) {
  const auth = await authenticate(request, env);
  if (!auth) return json({ user: null }, 401);
  return json({ user: publicUser(auth.user), csrfToken: auth.csrfToken });
}

async function changeVoterPassword(request, env, auth) {
  if (auth.user.role !== "voter") return json({ error: "Voter account required." }, 403);
  const body = await readJson(request);
  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");
  if (!currentPassword || newPassword.length < 12 || enc.encode(newPassword).length > 72)
    return json({ error: "Enter your current password and a new password of at least 12 characters and at most 72 UTF-8 bytes." }, 400);
  if (currentPassword === newPassword)
    return json({ error: "Your new password must differ from your current password." }, 400);

  const sb = db(env);
  // Reuse the existing login-attempts table to slow online guesses even if a
  // valid session is stolen. Both checks happen server-side, not in the form.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const attemptUser = `pwchange:${auth.user.id}`;
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const limits = await sb.from("login_attempts").select("id", { count: "exact", head: true })
    .eq("username", attemptUser).gte("attempted_at", cutoff);
  assertDb(limits.error);
  if (Number(limits.count || 0) >= 8)
    return json({ error: "Too many password-change attempts. Wait 15 minutes and try again." }, 429);

  const result = await sb.rpc("hoa_change_own_password", {
    p_user_id: auth.user.id,
    p_current_password: currentPassword,
    p_new_password: newPassword
  });
  if (result.error) {
    const message = String(result.error.message || "");
    if (/current password is incorrect/i.test(message)) {
      const attempt = await sb.from("login_attempts").insert({ ip, username: attemptUser });
      assertDb(attempt.error);
      return json({ error: "Current password is incorrect." }, 401);
    }
    if (/new password|password must/i.test(message)) return json({ error: message }, 400);
    assertDb(result.error);
  }
  // SQL invalidates every voter session within the password-change transaction.
  const headers = secureJsonHeaders();
  headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  return new Response(JSON.stringify({ ok: true, signedOut: true, message: "Password updated. Sign in again using your new password." }), { headers });
}

async function authenticate(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const sb = db(env);
  const tokenHash = await sha256(token);
  const { data: session, error } = await sb.from("sessions").select("token_hash,user_id,csrf_token,expires_at").eq("token_hash", tokenHash).maybeSingle();
  assertDb(error);
  if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
    if (session) await sb.from("sessions").delete().eq("token_hash", tokenHash);
    return null;
  }
  const { data: user, error: userError } = await sb.from("users").select("id,username,role,full_name,block,lot,active,must_change_password").eq("id", session.user_id).maybeSingle();
  assertDb(userError);
  if (!user?.active) {
    await sb.from("sessions").delete().eq("token_hash", tokenHash);
    return null;
  }
  return { user, csrfToken: session.csrf_token };
}

async function adminOverview(env) {
  const sb = db(env);
  const [votersR, electionsR, openR, participationR] = await Promise.all([
    sb.from("users").select("id", { count: "exact", head: true }).eq("role", "voter").eq("active", true),
    sb.from("elections").select("id", { count: "exact", head: true }),
    sb.from("elections").select("id", { count: "exact", head: true }).eq("status", "open").gt("voting_ends_at", new Date().toISOString()),
    sb.from("voter_participation").select("user_id")
  ]);
  [votersR, electionsR, openR, participationR].forEach(r => assertDb(r.error));
  return json({
    voters: Number(votersR.count || 0),
    elections: Number(electionsR.count || 0),
    openElections: Number(openR.count || 0),
    votersEverParticipated: new Set((participationR.data || []).map(x => String(x.user_id))).size
  });
}

async function listElections(env) {
  const sb = db(env);
  const [{ data: elections, error }, { data: positions, error: pError }, { data: ballots, error: bError }] = await Promise.all([
    sb.from("elections").select("*").order("id", { ascending: false }),
    sb.from("positions").select("id,election_id"),
    sb.from("ballots").select("id,election_id")
  ]);
  [error, pError, bError].forEach(assertDb);
  const pCounts = countBy(positions || [], "election_id");
  const bCounts = countBy(ballots || [], "election_id");
  return json({ elections: (elections || []).map(e => ({ ...visibleElection(e), position_count: pCounts.get(String(e.id)) || 0, ballots: bCounts.get(String(e.id)) || 0 })) });
}

async function createElection(request, env, admin) {
  const sb = db(env);
  const body = await readJson(request);
  const title = clean(body?.title, 120);
  const description = clean(body?.description, 500);
  if (body?.isTest !== undefined && typeof body.isTest !== "boolean")
    return json({ error: "Election type must be Test or Official." }, 400);
  const isTest = body?.isTest === true;
  if (!title) return json({ error: "Election title is required." }, 400);
  const schedule = validateTimeframe(body);
  if (schedule.error) return json({ error: schedule.error }, 400);
  const { data, error } = await sb.from("elections").insert({ title, description: description || null, created_by: admin.id, is_test: isTest, ...schedule }).select("id").single();
  assertDb(error);
  await audit(env, admin.id, "election.create", "election", data.id, { title, isTest, ...schedule });
  return json({ ok: true, id: data.id, isTest }, 201);
}

async function deleteElection(request, env, admin, electionId) {
  const sb = db(env);
  const body = await readJson(request);
  const confirmTitle = String(body?.confirmTitle || "").trim();
  const { data: election, error } = await sb.from("elections")
    .select("id,title,status,is_test").eq("id", electionId).maybeSingle();
  assertDb(error);
  if (!election) return json({ error: "Election not found." }, 404);
  if (!election.is_test) return json({ error: "Official elections cannot be deleted. The Test election checkbox must be selected when creating an election." }, 409);
  if (election.status === "open") return json({ error: "Close the test election before deleting it." }, 409);
  if (!confirmTitle || confirmTitle !== election.title || body?.confirmPhrase !== "DELETE TEST")
    return json({ error: "Confirm the exact test election title and type DELETE TEST." }, 400);

  const photoPaths = await electionCandidatePhotoPaths(sb, electionId);
  // The PostgreSQL RPC rechecks is_test, voting status and title under a row
  // lock, performs a single atomic deletion and preserves an audit trail.
  const { data, error: deleteError } = await sb.rpc("hoa_delete_test_election", {
    p_election_id: electionId, p_admin_id: admin.id, p_confirm_title: confirmTitle
  });
  if (deleteError) {
    const msg = deleteError.message || "Unable to delete test election.";
    if (/could not find the function|schema cache|PGRST202/i.test(msg))
      return json({ error: "Install and verify the v2.5.2 test-election SQL migration before using the updated website." }, 409);
    if (/official|test election|close|title|administrator|not found|confirmed/i.test(msg))
      return json({ error: msg }, 409);
    assertDb(deleteError);
  }
  await removeCandidatePhotoObjects(sb, photoPaths);
  return json({ ok: true, deleted: data });
}

async function getElection(env, electionId) {
  const sb = db(env);
  const [{ data: election, error }, { data: positions, error: pError }] = await Promise.all([
    sb.from("elections").select("*").eq("id", electionId).maybeSingle(),
    sb.from("positions").select("*").eq("election_id", electionId).order("sort_order").order("id")
  ]);
  assertDb(error); assertDb(pError);
  if (!election) return json({ error: "Election not found." }, 404);
  const positionIds = (positions || []).map(p => p.id);
  let candidates = [];
  if (positionIds.length) {
    const r = await sb.from("candidates").select("*").in("position_id", positionIds).order("sort_order").order("id");
    assertDb(r.error); candidates = (r.data || []).map(publicCandidate);
  }
  for (const p of positions || []) p.candidates = candidates.filter(c => Number(c.position_id) === Number(p.id));
  return json({ election: visibleElection(election), positions: positions || [] });
}

async function updateElectionStatus(request, env, admin, electionId) {
  const sb = db(env);
  const body = await readJson(request);
  const status = body?.status;
  if (!["draft", "open", "closed"].includes(status)) return json({ error: "Invalid election status." }, 400);
  const { data: election, error } = await sb.from("elections").select("*").eq("id", electionId).maybeSingle();
  assertDb(error);
  if (!election) return json({ error: "Election not found." }, 404);
  if (election.status === "closed" && status !== "closed") return json({ error: "A closed election cannot be reopened." }, 409);
  if (election.status === "open" && status === "draft") return json({ error: "An election cannot return to Draft after voting has opened." }, 409);
  if (status === "open") {
    if (election.status === "closed") return json({ error: "A closed election cannot be reopened." }, 409);
    if (!election.voting_ends_at || Date.parse(election.voting_ends_at) <= Date.now())
      return json({ error: "Set a future voting deadline before opening this election." }, 409);
    if (election.voting_starts_at && Date.parse(election.voting_starts_at) > Date.now())
      return json({ error: "The configured earliest voting start time has not arrived." }, 409);
    // Release the one-open-election constraint when another election reached
    // its deadline but Cron has not materialized its Closed status yet.
    await closeExpiredElections(env);
    const other = await sb.from("elections").select("id").eq("status", "open").neq("id", electionId).limit(1);
    assertDb(other.error);
    if (other.data?.length) return json({ error: "Another election is already open. Close it before opening this election." }, 409);
    const [{ count: pCount, error: pe }, { data: positions, error: pde }] = await Promise.all([
      sb.from("positions").select("id", { count: "exact", head: true }).eq("election_id", electionId),
      sb.from("positions").select("id").eq("election_id", electionId)
    ]);
    assertDb(pe); assertDb(pde);
    const ids = (positions || []).map(p => p.id);
    let cCount = 0;
    if (ids.length) {
      const cr = await sb.from("candidates").select("id", { count: "exact", head: true }).in("position_id", ids);
      assertDb(cr.error); cCount = Number(cr.count || 0);
    }
    if (Number(pCount || 0) < 1 || cCount < 1) return json({ error: "Add at least one position and candidate before opening voting." }, 409);
  }
  const patch = { status, updated_at: new Date().toISOString() };
  if (status === "open" && !election.opened_at) patch.opened_at = new Date().toISOString();
  if (status === "closed") patch.closed_at = election.voting_ends_at ? new Date(Math.min(Date.now(), Date.parse(election.voting_ends_at))).toISOString() : new Date().toISOString();
  const { error: updateError } = await sb.from("elections").update(patch).eq("id", electionId);
  if (updateError) {
    if (isUnique(updateError)) return json({ error: "Another election is already open." }, 409);
    if (/deadline|opening time|time frame|reopen/i.test(updateError.message || "")) return json({ error: updateError.message }, 409);
    assertDb(updateError);
  }
  await audit(env, admin.id, "election.status", "election", electionId, { from: election.status, to: status });
  return json({ ok: true });
}

// Schedule is immutable after voting first opens, even when a closed election
// has no ballots. PostgreSQL enforces the same rule on direct SQL/API writes.
async function updateElectionSchedule(request, env, admin, electionId) {
  const sb = db(env);
  const { data: election, error } = await sb.from("elections")
    .select("id,status").eq("id", electionId).maybeSingle();
  assertDb(error);
  if (!election) return json({ error: "Election not found." }, 404);
  if (election.status !== "draft") return json({ error: "Voting dates cannot change after an election opens." }, 409);
  const schedule = validateTimeframe(await readJson(request));
  if (schedule.error) return json({ error: schedule.error }, 400);
  const { data, error: updateError } = await sb.from("elections").update(schedule)
    .eq("id", electionId).eq("status", "draft").select("id").maybeSingle();
  if (updateError) assertDb(updateError);
  if (!data) return json({ error: "Election schedule was locked. Refresh and try again." }, 409);
  await audit(env, admin.id, "election.schedule", "election", electionId, schedule);
  return json({ ok: true, ...schedule });
}

async function addPosition(request, env, admin, electionId) {
  const sb = db(env);
  if (!(await electionIsDraft(env, electionId))) return json({ error: "Positions can only be changed while the election is in Draft." }, 409);
  const body = await readJson(request);
  const title = clean(body?.title, 100);
  const seats = Number(body?.seats || 1);
  if (!title || !Number.isInteger(seats) || seats < 1 || seats > 50) return json({ error: "Enter a position name and a valid number of seats (1–50)." }, 400);
  const { data: existing, error: orderError } = await sb.from("positions").select("sort_order").eq("election_id", electionId).order("sort_order", { ascending: false }).limit(1);
  assertDb(orderError);
  const sortOrder = Number(existing?.[0]?.sort_order || 0) + 1;
  const { data, error } = await sb.from("positions").insert({ election_id: electionId, title, seats, sort_order: sortOrder }).select("id").single();
  if (error) {
    if (isUnique(error)) return json({ error: "That position already exists in this election." }, 409);
    return dbConflict(error);
  }
  await audit(env, admin.id, "position.create", "position", data.id, { electionId, title, seats });
  return json({ ok: true, id: data.id }, 201);
}

async function deletePosition(env, admin, positionId) {
  const sb = db(env);
  const { data: p, error } = await sb.from("positions").select("id,title,election_id").eq("id", positionId).maybeSingle();
  assertDb(error);
  if (!p) return json({ error: "Position not found." }, 404);
  if (!(await electionIsDraft(env, p.election_id))) return json({ error: "Positions are locked once voting opens." }, 409);
  const { data: photoRows, error: photoError } = await sb.from("candidates").select("photo_path").eq("position_id", positionId);
  if (photoError && !candidatePhotoSchemaMissing(photoError)) assertDb(photoError);
  const photoPaths = (photoRows || []).map(c => c.photo_path).filter(Boolean);
  const r = await sb.from("positions").delete().eq("id", positionId);
  if (r.error) return dbConflict(r.error);
  await removeCandidatePhotoObjects(sb, photoPaths);
  await audit(env, admin.id, "position.delete", "position", positionId, { title: p.title });
  return json({ ok: true });
}

async function addCandidate(request, env, admin, positionId) {
  const sb = db(env);
  const { data: p, error } = await sb.from("positions").select("id,election_id").eq("id", positionId).maybeSingle();
  assertDb(error);
  if (!p) return json({ error: "Position not found." }, 404);
  if (!(await electionIsDraft(env, p.election_id))) return json({ error: "Candidates are locked once voting opens." }, 409);

  const input = await readCandidateForm(request);
  const fullName = clean(input.fullName, 100);
  const statement = clean(input.statement, 400);
  const photo = input.photo;
  if (!fullName) return json({ error: "Candidate name is required." }, 400);

  let preparedPhoto = null;
  if (isUploadedFile(photo) && photo.size > 0) {
    try { preparedPhoto = await prepareCandidatePhoto(photo); }
    catch (error) { return json({ error: error.message }, 400); }
  }

  const { data: existing, error: orderError } = await sb.from("candidates").select("sort_order").eq("position_id", positionId).order("sort_order", { ascending: false }).limit(1);
  assertDb(orderError);
  const sortOrder = Number(existing?.[0]?.sort_order || 0) + 1;
  const { data, error: insertError } = await sb.from("candidates").insert({ position_id: positionId, full_name: fullName, statement: statement || null, sort_order: sortOrder }).select("id").single();
  if (insertError) {
    if (isUnique(insertError)) return json({ error: "That candidate is already listed for this position." }, 409);
    return dbConflict(insertError);
  }

  let photoPath = null;
  if (preparedPhoto) {
    const uploaded = await uploadCandidatePhotoObject(sb, data.id, preparedPhoto);
    if (uploaded.error) {
      await sb.from("candidates").delete().eq("id", data.id);
      return candidatePhotoConfigError(uploaded.error);
    }
    photoPath = uploaded.path;
    const { error: photoUpdateError } = await sb.from("candidates").update({ photo_path: photoPath }).eq("id", data.id);
    if (photoUpdateError) {
      await removeCandidatePhotoObjects(sb, [photoPath]);
      await sb.from("candidates").delete().eq("id", data.id);
      if (candidatePhotoSchemaMissing(photoUpdateError)) return candidatePhotoConfigError(photoUpdateError);
      return dbConflict(photoUpdateError);
    }
  }

  await audit(env, admin.id, "candidate.create", "candidate", data.id, { positionId, fullName, hasPhoto: Boolean(photoPath) });
  return json({ ok: true, id: data.id, hasPhoto: Boolean(photoPath) }, 201);
}

async function updateCandidatePhoto(request, env, admin, candidateId) {
  const sb = db(env);
  const candidate = await getCandidateForPhotoChange(sb, candidateId);
  if (candidate.response) return candidate.response;
  if (!(await electionIsDraft(env, candidate.electionId))) return json({ error: "Candidate photos are locked once voting opens." }, 409);

  let form;
  try { form = await request.formData(); }
  catch { return json({ error: "Choose a JPEG, PNG, or WebP photo to upload." }, 400); }
  const photo = form.get("photo");
  if (!isUploadedFile(photo) || photo.size < 1) return json({ error: "Choose a candidate photo to upload." }, 400);

  let prepared;
  try { prepared = await prepareCandidatePhoto(photo); }
  catch (error) { return json({ error: error.message }, 400); }

  const uploaded = await uploadCandidatePhotoObject(sb, candidateId, prepared);
  if (uploaded.error) return candidatePhotoConfigError(uploaded.error);
  const { error: updateError } = await sb.from("candidates").update({ photo_path: uploaded.path }).eq("id", candidateId);
  if (updateError) {
    await removeCandidatePhotoObjects(sb, [uploaded.path]);
    if (candidatePhotoSchemaMissing(updateError)) return candidatePhotoConfigError(updateError);
    return dbConflict(updateError);
  }
  await removeCandidatePhotoObjects(sb, [candidate.photoPath]);
  await audit(env, admin.id, "candidate.photo_update", "candidate", candidateId, { fullName: candidate.fullName });
  return json({ ok: true, hasPhoto: true });
}

async function removeCandidatePhoto(env, admin, candidateId) {
  const sb = db(env);
  const candidate = await getCandidateForPhotoChange(sb, candidateId);
  if (candidate.response) return candidate.response;
  if (!(await electionIsDraft(env, candidate.electionId))) return json({ error: "Candidate photos are locked once voting opens." }, 409);
  if (!candidate.photoPath) return json({ ok: true, hasPhoto: false });

  const { error: updateError } = await sb.from("candidates").update({ photo_path: null }).eq("id", candidateId);
  if (updateError) {
    if (candidatePhotoSchemaMissing(updateError)) return candidatePhotoConfigError(updateError);
    return dbConflict(updateError);
  }
  await removeCandidatePhotoObjects(sb, [candidate.photoPath]);
  await audit(env, admin.id, "candidate.photo_remove", "candidate", candidateId, { fullName: candidate.fullName });
  return json({ ok: true, hasPhoto: false });
}

async function deleteCandidate(env, admin, candidateId) {
  const sb = db(env);
  const { data: c, error } = await sb.from("candidates").select("id,full_name,position_id,photo_path").eq("id", candidateId).maybeSingle();
  if (error) {
    if (candidatePhotoSchemaMissing(error)) {
      const fallback = await sb.from("candidates").select("id,full_name,position_id").eq("id", candidateId).maybeSingle();
      assertDb(fallback.error);
      if (!fallback.data) return json({ error: "Candidate not found." }, 404);
      return deleteCandidateWithoutPhotoColumn(env, admin, fallback.data);
    }
    assertDb(error);
  }
  if (!c) return json({ error: "Candidate not found." }, 404);
  const { data: p, error: pError } = await sb.from("positions").select("election_id").eq("id", c.position_id).single();
  assertDb(pError);
  if (!(await electionIsDraft(env, p.election_id))) return json({ error: "Candidates are locked once voting opens." }, 409);
  const r = await sb.from("candidates").delete().eq("id", candidateId);
  if (r.error) return dbConflict(r.error);
  await removeCandidatePhotoObjects(sb, [c.photo_path]);
  await audit(env, admin.id, "candidate.delete", "candidate", candidateId, { fullName: c.full_name });
  return json({ ok: true });
}

async function deleteCandidateWithoutPhotoColumn(env, admin, c) {
  const sb = db(env);
  const { data: p, error: pError } = await sb.from("positions").select("election_id").eq("id", c.position_id).single();
  assertDb(pError);
  if (!(await electionIsDraft(env, p.election_id))) return json({ error: "Candidates are locked once voting opens." }, 409);
  const r = await sb.from("candidates").delete().eq("id", c.id);
  if (r.error) return dbConflict(r.error);
  await audit(env, admin.id, "candidate.delete", "candidate", c.id, { fullName: c.full_name });
  return json({ ok: true });
}

async function candidatePhoto(env, candidateId) {
  const sb = db(env);
  const { data: candidate, error } = await sb.from("candidates").select("photo_path").eq("id", candidateId).maybeSingle();
  if (error) {
    if (candidatePhotoSchemaMissing(error)) return new Response(null, { status: 404 });
    assertDb(error);
  }
  if (!candidate?.photo_path) return new Response(null, { status: 404 });
  const { data, error: downloadError } = await sb.storage.from(CANDIDATE_PHOTO_BUCKET).download(candidate.photo_path);
  if (downloadError || !data) return new Response(null, { status: 404 });
  const headers = new Headers({
    "content-type": data.type || mimeFromPhotoPath(candidate.photo_path),
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
  });
  return new Response(data, { status: 200, headers });
}

// AES-GCM protects PRINTABLE INITIAL VOUCHERS only. The key remains outside
// Supabase, in Cloudflare's VOUCHER_ENCRYPTION_KEY secret. Reprints do not call
// any password-reset RPC or modify the stored password hash.
const VOUCHER_URL = "https://hoa-voting.casa-verde-de-banaderos.workers.dev/";
function voucherKeyBytes(env) {
  const hex = String(env.VOUCHER_ENCRYPTION_KEY || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error("VOUCHER_ENCRYPTION_KEY is not configured. Add a unique 32-byte (64-hex-character) key to the Production Worker secrets before issuing vouchers.");
  }
  return Uint8Array.from(hex.match(/.{2}/g), x => parseInt(x, 16));
}
function bytesHex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
function hexBytes(hex) { return Uint8Array.from(hex.match(/.{2}/g) || [], x => parseInt(x, 16)); }
async function voucherCryptoKey(env) {
  return crypto.subtle.importKey("raw", voucherKeyBytes(env), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function archiveVoucher(env, username, password) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce,
    additionalData: enc.encode("HOA-VOUCHER-v1:" + username) }, await voucherCryptoKey(env), enc.encode(password));
  return { voucherNonce: bytesHex(nonce), voucherCiphertext: bytesHex(new Uint8Array(ciphertext)) };
}
async function recoverVoucher(env, username, nonceHex, ciphertextHex) {
  const result = await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexBytes(nonceHex),
    additionalData: enc.encode("HOA-VOUCHER-v1:" + username) }, await voucherCryptoKey(env), hexBytes(ciphertextHex));
  return new TextDecoder().decode(result);
}
// Re-enter the administrator's password before revealing encrypted credentials.
// This prevents a left-open admin page from silently printing every password.
async function verifyAdminReprintPassword(sb, admin, password) {
  if (!password || password.length > 256) return false;
  const r = await sb.rpc("hoa_verify_login", { p_username: admin.username, p_password: password });
  assertDb(r.error);
  return (r.data || []).some(x => Number(x.id) === Number(admin.id) && x.role === "admin");
}
// Reprint and legacy credential reissue share one per-admin/IP password-guess limit.
// Both routes require an authenticated admin session AND CSRF validation above.
async function voucherAdminAuthorization(request, sb, admin, password) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rateName = `voucher-reprint:${admin.id}`;
  const rate = await sb.from("login_attempts").select("id", { count: "exact", head: true })
    .eq("ip", ip).eq("username", rateName)
    .gte("attempted_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
  assertDb(rate.error);
  if (Number(rate.count || 0) >= 5) return json({ error: "Too many failed voucher authorizations. Try again in 15 minutes." }, 429);
  if (!await verifyAdminReprintPassword(sb, admin, password)) {
    const fail = await sb.from("login_attempts").insert({ ip, username: rateName, attempted_at: new Date().toISOString() });
    assertDb(fail.error);
    return json({ error: "Re-enter your administrator password to authorize vouchers." }, 403);
  }
  const clear = await sb.from("login_attempts").delete().eq("ip", ip).eq("username", rateName);
  assertDb(clear.error);
  return null;
}

// Name, username and the public website QR only. Never modify a credential.
async function printQrSlips(env, admin) {
  const sb = db(env);
  const r = await sb.from("users").select("id,username,full_name,block,lot")
    .eq("role", "voter").eq("active", true).order("id", { ascending: true }).limit(501);
  assertDb(r.error);
  if ((r.data || []).length > 500) return json({ error: "More than 500 active voters. Print in smaller batches." }, 400);
  const voters = (r.data || []).map(x => ({ id: x.id, username: x.username,
    fullName: x.full_name, block: x.block, lot: x.lot }));
  const auditResult = await sb.from("audit_log").insert({ admin_user_id: admin.id,
    action: "voter.qr_slips_print", entity_type: "voter", entity_id: "all",
    details: { count: voters.length, voterIds: voters.map(x => x.id), passwordIncluded: false } });
  assertDb(auditResult.error);
  return json({ ok: true, voters, passwordsUnchanged: true, passwordIncluded: false });
}

// This is NOT a reprint. It is a distinct, explicitly confirmed admin operation.
// Only active, pre-archive voter accounts STILL needing their first password
// change can receive fresh credentials. Personalized passwords are protected.
async function reissueLegacyVouchers(request, env, admin) {
  const body = await readJson(request, 64 * 1024);
  const ids = body?.voterIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 ||
      ids.some(id => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(ids).size !== ids.length || body?.confirm !== "REISSUE") {
    return json({ error: "Select 1 to 20 distinct legacy voters and explicitly confirm REISSUE." }, 400);
  }
  const sb = db(env);
  const authorized = await voucherAdminAuthorization(request, sb, admin, String(body?.adminPassword || ""));
  if (authorized) return authorized;
  const locked = await voterRegistrationLock(sb);
  if (locked) return locked;
  // Fail before any passwords are changed if the encryption key is missing.
  voucherKeyBytes(env);
  const { data: rows, error } = await sb.from("users")
    .select("id,username,full_name,block,lot,active,must_change_password")
    .eq("role", "voter").in("id", ids).order("id", { ascending: true });
  assertDb(error);
  if ((rows || []).length !== ids.length) return json({ error: "Some selected voter accounts no longer exist." }, 409);
  if (rows.some(x => !x.active || !x.must_change_password))
    return json({ error: "Only active voters who have not changed their initial password may receive legacy replacements." }, 409);
  const archived = await sb.from("voter_vouchers").select("voter_id").in("voter_id", ids);
  assertDb(archived.error);
  if (archived.data?.length)
    return json({ error: "Some accounts now have printable archived credentials. Reprint those unchanged instead." }, 409);
  const credentials = [];
  for (const voter of rows) {
    const password = strongVoterPassword();
    const archive = await archiveVoucher(env, voter.username, password);
    credentials.push({ voterId: voter.id, username: voter.username,
      fullName: voter.full_name, block: voter.block, lot: voter.lot,
      password, ...archive });
  }
  // All-or-nothing within this batch; SQL rechecks eligibility under row locks,
  // freezes changes during an open election and audits without plaintext secrets.
  const result = await sb.rpc("hoa_reissue_legacy_vouchers", {
    p_admin_id: admin.id,
    p_voters: credentials.map(x => ({ voterId: x.voterId, password: x.password,
      voucherNonce: x.voucherNonce, voucherCiphertext: x.voucherCiphertext }))
  });
  if (result.error) {
    if (/could not find the function|schema cache|PGRST202/i.test(result.error.message || ""))
      return json({ error: "Install supabase/v2.5.1-install-parts/01_bulk_legacy_voucher_reissue.sql and verify its permissions before using bulk replacements." }, 409);
    if (/legacy|voter|election|archive|voucher|cannot|locked|open/i.test(result.error.message || ""))
      return json({ error: "Replacement batch was not issued: " + result.error.message }, 409);
    assertDb(result.error);
  }
  if (Number(result.data) !== credentials.length)
    return json({ error: "Unexpected voucher issuance count. Verify the archived vouchers before retrying." }, 503);
  return json({ ok: true, count: credentials.length, voters: credentials.map(({ voucherNonce, voucherCiphertext, voterId, ...safe }) => ({ id: voterId, ...safe })),
    passwordsReplaced: true });
}

async function reprintVouchers(request, env, admin) {
  // The Print/Reprint endpoint never generates or resets a password.
  const body = await readJson(request);
  const password = String(body?.adminPassword || "");
  const sb = db(env);
  const authorized = await voucherAdminAuthorization(request, sb, admin, password);
  if (authorized) return authorized;
  const isAll = body?.all === true;
  const selected = body?.voterIds;
  if (!isAll && (!Array.isArray(selected) || !selected.length || selected.length > 500 ||
    selected.some(n => !Number.isSafeInteger(n) || n <= 0) || new Set(selected).size !== selected.length))
    return json({ error: "Select 1 to 500 distinct voter accounts." }, 400);
  const usersQuery = sb.from("users").select("id,username,full_name,block,lot,must_change_password,active")
    .eq("role", "voter").order("id", { ascending: true }).limit(501);
  const userResult = isAll ? await usersQuery : await usersQuery.in("id", selected);
  assertDb(userResult.error);
  const users = userResult.data || [];
  if (users.length > 500) return json({ error: "More than 500 voters are registered. Print in smaller selected batches." }, 400);
  if (!isAll && users.length !== selected.length) return json({ error: "Some selected voters no longer exist." }, 404);
  const eligible = users.filter(x => x.active && x.must_change_password);
  const result = eligible.length ? await sb.from("voter_vouchers")
    .select("voter_id,nonce_hex,ciphertext_hex").in("voter_id", eligible.map(x => x.id)) : { data: [], error: null };
  assertDb(result.error);
  const archives = new Map((result.data || []).map(x => [Number(x.voter_id), x]));
  const vouchers = [];
  const skipped = [];
  for (const user of users) {
    const row = archives.get(Number(user.id));
    if (!user.active || !user.must_change_password || !row) {
      skipped.push({ id: user.id, username: user.username,
        reason: !user.active ? "Account disabled" : !user.must_change_password ? "Voter changed their initial password" : "No recoverable original voucher (issued before archive)" });
      continue;
    }
    let plaintext;
    try { plaintext = await recoverVoucher(env, user.username, row.nonce_hex, row.ciphertext_hex); }
    catch { return json({ error: "Encrypted voucher could not be opened. Check that the original VOUCHER_ENCRYPTION_KEY is still configured; no passwords were changed." }, 503); }
    vouchers.push({ id: user.id, username: user.username, password: plaintext,
      fullName: user.full_name, block: user.block, lot: user.lot });
  }
  // Fail closed if disclosure cannot be independently audited. NEVER log secrets.
  const auditR = await sb.from("audit_log").insert({ admin_user_id: admin.id,
    action: "voter.voucher_reprint", entity_type: "voter", entity_id: "selected",
    details: { count: vouchers.length, voterIds: vouchers.map(x => x.id),
      skipped: skipped.map(x => x.id), all: isAll } });
  assertDb(auditR.error);
  return json({ ok: true, portal: VOUCHER_URL, voters: vouchers, skipped, passwordsUnchanged: true });
}

async function getCommittee(env, electionId) {
  const sb = db(env);
  const r = await sb.from("election_committee_members")
    .select("id,full_name,committee_role,display_order").eq("election_id", electionId)
    .order("display_order", { ascending: true });
  assertDb(r.error);
  return json({ members: (r.data || []).map(x => ({ id: x.id, fullName: x.full_name, role: x.committee_role })) });
}
async function saveCommittee(request, env, admin, electionId) {
  const data = await readJson(request);
  if (!Array.isArray(data?.members) || data.members.length > 12)
    return json({ error: "Provide up to 12 Election Committee names." }, 400);
  const allowedRoles = new Set(["Chairperson", "Vice Chairperson", "Secretary", "Member", "Canvasser"]);
  const members = data.members.map(x => ({ fullName: clean(x?.fullName, 100), role: String(x?.role || "") }));
  if (members.some(x => x.fullName.length < 2 || !allowedRoles.has(x.role)))
    return json({ error: "Invalid Election Committee name or role." }, 400);
  if (members.filter(x => x.role === "Chairperson").length > 1)
    return json({ error: "Only one Chairperson is allowed." }, 400);
  const sb = db(env);
  const r = await sb.rpc("hoa_replace_election_committee", { p_election_id: electionId, p_members: members });
  if (r.error && /committee cannot change|election not found/i.test(r.error.message || ""))
    return json({ error: r.error.message }, 409);
  assertDb(r.error);
  await audit(env, admin.id, "election.committee_update", "election", electionId,
    { count: members.length, members });
  return json({ ok: true, count: Number(r.data || 0) });
}

async function listVoters(env, url) {
  const sb = db(env);
  const search = clean(url.searchParams.get("search"), 80).toLowerCase();
  const electionId = Number(url.searchParams.get("electionId") || 0);
  const { data: voters, error } = await sb.from("users").select("id,username,full_name,block,lot,active,must_change_password,created_at").eq("role", "voter");
  const archived = await sb.from("voter_vouchers").select("voter_id").limit(1000);
  assertDb(archived.error);
  const archiveIds = new Set((archived.data || []).map(x => Number(x.voter_id)));
  assertDb(error);
  let participation = [];
  if (electionId) {
    const r = await sb.from("voter_participation").select("user_id,voted_at").eq("election_id", electionId);
    assertDb(r.error); participation = r.data || [];
  }
  const pMap = new Map(participation.map(p => [String(p.user_id), p]));
  let rows = (voters || []).map(v => ({ ...v,
    voucherAvailable: Boolean(v.active && v.must_change_password && archiveIds.has(Number(v.id))),
    voted: pMap.has(String(v.id)), voted_at: pMap.get(String(v.id))?.voted_at || null }));
  if (search) rows = rows.filter(v => [v.full_name, v.username, v.block, v.lot].some(x => String(x || "").toLowerCase().includes(search)));
  rows.sort(voterSort);
  return json({ voters: rows });
}

async function createVoter(request, env, admin) {
  const sb = db(env);
  const body = await readJson(request);
  const fullName = clean(body?.fullName, 100);
  const block = canonicalUnit(body?.block);
  const lot = canonicalUnit(body?.lot);
  if (!fullName || !block || !lot) return json({ error: "Full name, block, and lot are required." }, 400);
  const lock = await voterRegistrationLock(sb);
  if (lock) return lock;
  const { data: existingOwners, error: ownersError } = await sb.from("users")
    .select("id,full_name").eq("role", "voter");
  assertDb(ownersError);
  if ((existingOwners || []).some(u => normalizedOwnerName(u.full_name) === normalizedOwnerName(fullName)))
    return json({ error: "A voting account already exists for this homeowner. Link additional lots to the existing account instead." }, 409);

  let username = null;
  for (let i = 0; i < 12; i++) {
    const candidate = `HOA-${randomFromAlphabet(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")}`;
    const { count, error } = await sb.from("users").select("id", { count: "exact", head: true }).ilike("username", candidate);
    assertDb(error);
    if (!count) { username = candidate; break; }
  }
  if (!username) return json({ error: "Could not generate a unique username. Try again." }, 500);

  const password = strongVoterPassword();
  const archive = await archiveVoucher(env, username, password);
  const { data: id, error } = await sb.rpc("hoa_create_voter_with_voucher", {
    p_username: username, p_password: password, p_full_name: fullName,
    p_block: block, p_lot: lot, p_ciphertext_hex: archive.voucherCiphertext,
    p_nonce_hex: archive.voucherNonce
  });
  if (error) {
    if (isUnique(error)) return json({ error: "This Block/Lot, homeowner, or username already has a voter account." }, 409);
    if (/registration is locked while an election is open/i.test(error.message || "")) return json({ error: "Voter registration is locked while an election is open." }, 409);
    assertDb(error);
  }
  await audit(env, admin.id, "voter.create", "user", id, { username, fullName, block, lot });
  return json({ ok: true, voter: { id, username, password, fullName, block, lot } }, 201);
}

// Registration is frozen while an election is live. Batch insert still checks
// this in PostgreSQL; the Worker check is for a clear and immediate message.
async function voterRegistrationLock(sb) {
  const { data, error } = await sb.from("elections").select("id").eq("status", "open").limit(1);
  assertDb(error);
  return data?.length ? json({ error: "Voter registration is locked while an election is open." }, 409) : null;
}

function normalizedOwnerName(value) {
  return clean(value, 100).replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function canonicalUnit(value) {
  const v = clean(value, 40);
  return /^0*[0-9]+$/.test(v) ? v.replace(/^0+(?=\d)/, "") : v;
}

async function bulkCreateVoters(request, env, admin) {
  const body = await readJson(request);
  const rows = body?.voters;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 20)
    return json({ error: "Send 1 to 20 verified voters per batch." }, 400);
  const batch = [];
  const units = new Set();
  const owners = new Set();
  for (const row of rows) {
    const fullName = clean(row?.fullName, 100);
    const block = canonicalUnit(row?.block);
    const lot = canonicalUnit(row?.lot);
    if (!fullName || !block || !lot) return json({ error: "All imported voters need a name, block and lot." }, 400);
    const key = `${block.toLowerCase()}|${lot.toLowerCase()}`;
    if (units.has(key)) return json({ error: `Repeated Block/Lot in batch: ${block}/${lot}.` }, 409);
    units.add(key);
    const ownerKey = normalizedOwnerName(fullName);
    if (owners.has(ownerKey)) return json({ error: `Homeowner appears more than once in the same batch: ${fullName}. One account per homeowner is required.` }, 409);
    owners.add(ownerKey);
    batch.push({ fullName, block, lot,
      username: `HOA-${randomFromAlphabet(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")}`,
      password: strongVoterPassword() });
  }
  const sb = db(env);
  const lock = await voterRegistrationLock(sb);
  if (lock) return lock;
  for (const voter of batch) Object.assign(voter, await archiveVoucher(env, voter.username, voter.password));
  const { data, error } = await sb.rpc("hoa_bulk_create_voters_with_vouchers", { p_voters: batch });
  if (error) {
    if (isUnique(error)) return json({ error: "A voter account already exists for one or more homeowners or units. Refresh the list and reconcile before retrying." }, 409);
    if (/registration is locked while an election is open/i.test(error.message || "")) return json({ error: "Voter registration is locked while an election is open." }, 409);
    assertDb(error);
  }
  // Pair each password to the exact database-confirmed username, NOT a returned
  // array index. A reordered SQL JSON result must never print the wrong secret
  // on someone else's voucher.
  const passwordByUsername = new Map(batch.map(v => [v.username, v.password]));
  const output = (data || []).map(v => ({ ...v, password: passwordByUsername.get(v.username) }));
  if (output.length !== batch.length || output.some(v => !v.password)) {
    // Inserts already committed. Never issue guessed credentials; the admin
    // must reconcile the database and reset affected passwords.
    console.error("Unexpected bulk credential mapping. Manual password reset required.");
    return json({ error: "Accounts were created but the database returned an invalid credential mapping. Do not retry this batch; reconcile and reset affected passwords." }, 502);
  }
  let auditWarning = false;
  try {
    await audit(env, admin.id, "voter.bulk_create", "user", "batch", {
      count: output.length, units: output.map(v => `${v.block}/${v.lot}`),
      ids: output.map(v => v.id)
    });
  } catch (error) {
    // Account creation has already committed. Preserve the one-time credentials
    // in the response even when a secondary audit-table insert is unavailable.
    console.error("Bulk voter audit logging failed after account creation:", error);
    auditWarning = true;
  }
  return json({ ok: true, count: output.length, voters: output, auditWarning }, 201);
}

async function deleteVoter(env, admin, voterId) {
  const sb = db(env);
  const lock = await voterRegistrationLock(sb);
  if (lock) return lock;
  const { data: voter, error } = await sb.from("users")
    .select("id,username,full_name,block,lot")
    .eq("id", voterId)
    .eq("role", "voter")
    .maybeSingle();
  assertDb(error);
  if (!voter) return json({ error: "Voter not found." }, 404);

  // Once a voter has participated, keep the identity/participation record intact so
  // turnout history cannot be altered and the same resident cannot be recreated to vote again.
  const { count: participationCount, error: participationError } = await sb.from("voter_participation")
    .select("user_id", { count: "exact", head: true })
    .eq("user_id", voterId);
  assertDb(participationError);
  if (Number(participationCount || 0) > 0) {
    return json({
      error: "This voter has voting history and cannot be permanently deleted. Disable the account instead to preserve election records."
    }, 409);
  }

  const { error: deleteError } = await sb.from("users").delete().eq("id", voterId).eq("role", "voter");
  if (deleteError) {
    const msg = String(deleteError.message || "");
    if (deleteError.code === "23503" || /foreign key|voter_participation/i.test(msg)) {
      return json({
        error: "This voter has voting history and cannot be permanently deleted. Disable the account instead to preserve election records."
      }, 409);
    }
    assertDb(deleteError);
  }

  await audit(env, admin.id, "voter.delete", "user", voterId, {
    username: voter.username,
    fullName: voter.full_name,
    block: voter.block,
    lot: voter.lot
  });
  return json({ ok: true });
}

async function resetVoterPassword(env, admin, voterId) {
  const sb = db(env);
  const lock = await voterRegistrationLock(sb);
  if (lock) return lock;
  const { data: voter, error } = await sb.from("users").select("id,username,full_name,block,lot").eq("id", voterId).eq("role", "voter").maybeSingle();
  assertDb(error);
  if (!voter) return json({ error: "Voter not found." }, 404);
  const password = strongVoterPassword();
  const archive = await archiveVoucher(env, voter.username, password);
  const r = await sb.rpc("hoa_reset_password_with_voucher", {
    p_user_id: voterId, p_password: password,
    p_ciphertext_hex: archive.voucherCiphertext, p_nonce_hex: archive.voucherNonce
  });
  assertDb(r.error);
  if (!r.data) return json({ error: "Voter not found." }, 404);
  await audit(env, admin.id, "voter.password_reset", "user", voterId, { username: voter.username });
  return json({ ok: true, username: voter.username, password, fullName: voter.full_name, block: voter.block, lot: voter.lot });
}

async function toggleVoter(request, env, admin, voterId) {
  const sb = db(env);
  const body = await readJson(request);
  const active = Boolean(body?.active);
  // Freeze all admin-initiated account/status changes during live voting.
  // Otherwise an administrator could change credentials and impersonate a voter.
  const lock = await voterRegistrationLock(sb);
  if (lock) return lock;
  const { data: voter, error } = await sb.from("users").select("id,username").eq("id", voterId).eq("role", "voter").maybeSingle();
  assertDb(error);
  if (!voter) return json({ error: "Voter not found." }, 404);
  const { error: updateError } = await sb.from("users").update({ active, updated_at: new Date().toISOString() }).eq("id", voterId);
  assertDb(updateError);
  if (!active) await sb.from("sessions").delete().eq("user_id", voterId);
  await audit(env, admin.id, active ? "voter.activate" : "voter.deactivate", "user", voterId, { username: voter.username });
  return json({ ok: true });
}

async function voterBallot(env, user) {
  if (user.role !== "voter") return json({ error: "Voter account required." }, 403);
  const sb = db(env);
  const { data: elections, error } = await sb.from("elections").select("*").eq("status", "open")
    .gt("voting_ends_at", new Date().toISOString())
    .order("opened_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  assertDb(error);
  const election = elections?.[0];
  if (!election) {
    // Let someone who voted retrieve their receipt after the polls close,
    // without providing ballot choices or offering a new ballot.
    const { data: parts, error: pError } = await sb.from("voter_participation")
      .select("election_id,voted_at,receipt_code").eq("user_id", user.id)
      .order("voted_at", { ascending: false }).limit(1);
    assertDb(pError);
    if (parts?.length) {
      const { data: last, error: eError } = await sb.from("elections")
        .select("*").eq("id", parts[0].election_id).maybeSingle();
      assertDb(eError);
      if (last) return json({ election: publicElection(visibleElection(last)), voted: true, votedAt: parts[0].voted_at, receiptCode: parts[0].receipt_code });
    }
    return json({ election: null, message: "There is no election accepting ballots right now. Voting closes automatically at its published deadline." });
  }
  const { data: participation, error: pError } = await sb.from("voter_participation").select("voted_at,receipt_code").eq("user_id", user.id).eq("election_id", election.id).maybeSingle();
  assertDb(pError);
  if (participation) return json({ election: publicElection(election), voted: true, votedAt: participation.voted_at, receiptCode: participation.receipt_code });
  const detail = await getElectionData(env, election.id);
  return json({ election: publicElection(election), voted: false, positions: detail.positions });
}

async function submitVote(request, env, user) {
  if (user.role !== "voter") return json({ error: "Voter account required." }, 403);
  const body = await readJson(request);
  const electionId = Number(body?.electionId);
  const selections = body?.selections;
  if (!electionId || !selections || typeof selections !== "object" || Array.isArray(selections)) return json({ error: "Invalid ballot." }, 400);

  // Fast friendly validation in the Worker; PostgreSQL repeats all critical checks atomically.
  const sb = db(env);
  const { data: election, error } = await sb.from("elections").select("id,status,voting_ends_at").eq("id", electionId).eq("status", "open").maybeSingle();
  assertDb(error);
  if (!election || !election.voting_ends_at || Date.parse(election.voting_ends_at) <= Date.now())
    return json({ error: "Voting has closed: the election deadline has passed or the polls are not open." }, 409);
  const detail = await getElectionData(env, electionId);
  const positions = new Map(detail.positions.map(p => [String(p.id), p]));
  const candidateToPosition = new Map();
  for (const p of detail.positions) for (const c of p.candidates) candidateToPosition.set(Number(c.id), Number(p.id));
  let total = 0;
  for (const [positionKey, raw] of Object.entries(selections)) {
    const p = positions.get(String(positionKey));
    if (!p) return json({ error: "Ballot contains an invalid position." }, 400);
    const ids = [...new Set((Array.isArray(raw) ? raw : []).map(Number))];
    if (ids.length > Number(p.seats)) return json({ error: `Too many selections for ${p.title}.` }, 400);
    for (const id of ids) if (candidateToPosition.get(id) !== Number(p.id)) return json({ error: "Ballot contains an invalid candidate selection." }, 400);
    total += ids.length;
  }
  if (total < 1) return json({ error: "Select at least one candidate before submitting." }, 400);

  const ballotId = crypto.randomUUID();
  const receiptCode = `VOTE-${randomFromAlphabet(10, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")}`;
  const { data, error: voteError } = await sb.rpc("hoa_submit_ballot", {
    p_user_id: user.id,
    p_election_id: electionId,
    p_ballot_id: ballotId,
    p_receipt_code: receiptCode,
    p_selections: selections
  });
  if (voteError) {
    const msg = voteError.message || "Vote submission failed.";
    if (/already submitted/i.test(msg)) return json({ error: "This voter account has already submitted a ballot." }, 409);
    if (/not open|deadline|closed|voting period/i.test(msg)) return json({ error: "Voting is closed or the election deadline has passed." }, 409);
    if (/invalid|too many|select at least/i.test(msg)) return json({ error: msg.replace(/^.*?:\s*/, "") }, 400);
    assertDb(voteError);
  }
  return json({ ok: true, receiptCode: data || receiptCode });
}

// Final reports are built from server-owned election data. The browser sends
// no vote totals and cannot override ranks or the election cutoff.
async function buildElectionResults(env, electionId) {
  const sb = db(env);
  const { data: election, error } = await sb.from("elections").select("*").eq("id", electionId).maybeSingle();
  assertDb(error);
  if (!election) return null;
  const [{ count: currentActive, error: eError }, { count: ballotsCast, error: tError }, { count: anonymousBallots, error: bError }, detail, votesR, integrityR] = await Promise.all([
    sb.from("users").select("id", { count: "exact", head: true }).eq("role", "voter").eq("active", true),
    sb.from("voter_participation").select("user_id", { count: "exact", head: true }).eq("election_id", electionId),
    sb.from("ballots").select("id", { count: "exact", head: true }).eq("election_id", electionId),
    getElectionData(env, electionId),
    sb.rpc("hoa_candidate_vote_totals", { p_election_id: electionId }),
    sb.rpc("hoa_ballot_integrity_summary", { p_election_id: electionId })
  ]);
  assertDb(eError); assertDb(tError); assertDb(bError); assertDb(votesR.error);
  // Before v2.5.4 is installed, report UNVERIFIED rather than falsely claiming
  // ballot integrity. An unrelated database error is still a hard failure.
  const migrationMissing = Boolean(integrityR.error &&
    /PGRST202|could not find the function|schema cache/i.test(String(integrityR.error.message || "")));
  if (integrityR.error && !migrationMissing) assertDb(integrityR.error);
  const voteCounts = new Map((votesR.data || []).map(x => [String(x.candidate_id), Number(x.votes || 0)]));
  for (const p of detail.positions) {
    let totalVotes = 0;
    const candidates = p.candidates.map(c => {
      const votes = voteCounts.get(String(c.id)) || 0;
      totalVotes += votes;
      return { ...c, votes };
    }).sort((a,b) => b.votes - a.votes || a.full_name.localeCompare(b.full_name));
    p.totalVotes = totalVotes;
    p.candidates = candidates.map(c => ({ ...c,
      // Share of selections is not the same as share of participating voters
      // when a position has multiple seats.
      percentage: totalVotes ? Number(((c.votes / totalVotes) * 100).toFixed(1)) : 0,
      voterSupportPercentage: Number(ballotsCast || 0) ? Number(((c.votes / Number(ballotsCast)) * 100).toFixed(1)) : 0
    }));
  }
  // A snapshot captured automatically by PostgreSQL at Draft -> Open is
  // preferable to counting active accounts after the election has finished.
  const atOpening = Number.isInteger(election.eligible_voters_at_open) ? election.eligible_voters_at_open : null;
  const eligibleVoters = atOpening ?? Number(currentActive || 0);
  const cast = Number(ballotsCast || 0);
  const ballotRows = Number(anonymousBallots || 0);
  const fields = ["ballotRows", "committedBallots", "legacyBallots", "mismatchedBallots",
    "expectedSelections", "actualSelections", "invalidVoteRows", "crossElectionVoteRows"];
  const rawIntegrity = integrityR.data;
  const integrityDetails = !migrationMissing && rawIntegrity && typeof rawIntegrity === "object" &&
    fields.every(k => rawIntegrity[k] !== null && rawIntegrity[k] !== undefined &&
      Number.isSafeInteger(Number(rawIntegrity[k])) && Number(rawIntegrity[k]) >= 0)
    ? Object.fromEntries(fields.map(k => [k, Number(rawIntegrity[k])])) : null;
  const reportedSelections = detail.positions.reduce((sum, p) => sum + p.totalVotes, 0);
  // This is a three-state assessment (verified / mismatch / unverifiable).
  // Counting participants and ballots alone cannot detect missing vote rows.
  const integrityStatus = migrationMissing ? "migration_required"
    : !integrityDetails ? "unverified"
    : cast !== ballotRows || integrityDetails.ballotRows !== ballotRows ||
      integrityDetails.mismatchedBallots > 0 || integrityDetails.invalidVoteRows > 0 ||
      integrityDetails.crossElectionVoteRows > 0 ||
      (integrityDetails.legacyBallots === 0 &&
       integrityDetails.expectedSelections !== integrityDetails.actualSelections) ||
      integrityDetails.actualSelections !== reportedSelections ||
      integrityDetails.committedBallots + integrityDetails.legacyBallots !== ballotRows
      ? "mismatch"
    : integrityDetails.legacyBallots > 0 ? "legacy_unverifiable" : "verified";
  return {
    election: visibleElection(election),
    eligibleVoters,
    eligibilitySource: atOpening === null ? "current_active_unverified" : "captured_at_open",
    ballotsCast: cast,
    anonymousBallots: ballotRows,
    ballotRecordCountMatches: cast === ballotRows, // Legacy count-only field; do NOT use for certification.
    voteRecordIntegrityOk: integrityStatus === "verified",
    integrityStatus,
    integrityDetails,
    turnoutPercentage: eligibleVoters ? Number(((cast / eligibleVoters) * 100).toFixed(1)) : 0,
    positions: detail.positions
  };
}

async function electionResults(env, electionId) {
  const d = await buildElectionResults(env, electionId);
  return d ? json(d) : json({ error: "Election not found." }, 404);
}

// Competition-style ranks (1, 1, 3). A tie across the seat cutoff is NEVER
// auto-proclaimed; ELECOM must document its resolution under HOA rules.
function rankElectionPosition(position) {
  const candidates = [...position.candidates].sort((a,b) => b.votes-a.votes || a.full_name.localeCompare(b.full_name));
  const seats = Math.max(1, Number(position.seats || 1));
  const cutoff = candidates.length >= seats ? candidates[seats-1].votes : null;
  const above = cutoff === null ? 0 : candidates.filter(c => c.votes > cutoff).length;
  const onBoundary = cutoff === null ? 0 : candidates.filter(c => c.votes === cutoff).length;
  const boundaryTie = cutoff !== null && onBoundary > seats - above;
  let prevVotes = null;
  let prevRank = 0;
  const rows = candidates.map((candidate, index) => {
    const rank = candidate.votes === prevVotes ? prevRank : index + 1;
    prevVotes = candidate.votes;
    prevRank = rank;
    let result = "Outside seat allocation";
    if (index < seats || (boundaryTie && cutoff !== null && candidate.votes === cutoff)) {
      result = boundaryTie && candidate.votes === cutoff
        ? "TIE - ELECOM decision required"
        : "Within available seats - provisional";
    }
    return { candidateId: candidate.id, candidateName: candidate.full_name,
      votes: Number(candidate.votes || 0), rank, result };
  });
  return { title: position.title, seats, totalSelections: Number(position.totalVotes || 0),
    cutoffTie: boundaryTie, rows };
}

async function dhsudFinalElectionReport(env, electionId) {
  const data = await buildElectionResults(env, electionId);
  if (!data) return json({ error: "Election not found." }, 404);
  if (data.election.status !== "closed") return json({ error: "Final DHSUD-aligned exports are available only after the election closes." }, 409);
  const election = data.election;
  const positions = data.positions.map(rankElectionPosition);
  const roster = await db(env).from("election_committee_members")
    .select("full_name,committee_role,display_order")
    .eq("election_id", electionId).order("display_order", { ascending: true });
  assertDb(roster.error);
  return json({
    reportKind: election.is_test ? "PRACTICE ONLY - Mock election tally, not for filing" : "DHSUD-aligned ELECOM election report and tally (not a government-issued form)",
    sourceReference: "2024 Revised IRR of RA 9904, Section 101 (DHSUD Department Circular 2024-018)",
    associationName: "Casa Verde de Bañaderos",
    election: { id: election.id, title: election.title, isTest: Boolean(election.is_test), status: "closed",
      votingStartsAt: election.voting_starts_at || null,
      votingEndsAt: election.voting_ends_at || null,
      openedAt: election.opened_at || null,
      closedAt: election.closed_at || election.voting_ends_at || null },
    eligibleVoters: data.eligibleVoters,
    eligibleCountBasis: data.eligibilitySource === "captured_at_open"
      ? "Active voter accounts at the time the polls opened; ELECOM must verify the certified qualified-voter list."
      : "Active voter accounts at export only (legacy election lacks opening snapshot); ELECOM verification required.",
    verifiedOpeningSnapshot: data.eligibilitySource === "captured_at_open",
    ballotsCast: data.ballotsCast,
    anonymousBallots: data.anonymousBallots,
    voteRecordIntegrityOk: data.voteRecordIntegrityOk,
    integrityStatus: data.integrityStatus,
    integrityDetails: data.integrityDetails,
    turnoutPercentage: data.turnoutPercentage,
    hasUnresolvedSeatTies: positions.some(p => p.cutoffTie),
    positions,
    committeeMembers: (roster.data || []).map(x => ({ fullName: x.full_name, role: x.committee_role })),
    exportGeneratedAt: new Date().toISOString(),
    certificateState: election.is_test ? "TEST ONLY - not a valid or certifiable election result." : "Uncertified system tabulation - requires ELECOM review, signatures and any notarization required by DHSUD."
  });
}

async function participationReport(env, electionId, url) {
  const sb = db(env);
  const { data: election, error } = await sb.from("elections").select("id,title,status,is_test").eq("id", electionId).maybeSingle();
  assertDb(error);
  if (!election) return json({ error: "Election not found." }, 404);
  const [{ data: voters, error: vError }, { data: parts, error: pError }] = await Promise.all([
    sb.from("users").select("id,full_name,block,lot,username,active").eq("role", "voter"),
    sb.from("voter_participation").select("user_id,voted_at").eq("election_id", electionId)
  ]);
  assertDb(vError); assertDb(pError);
  const map = new Map((parts || []).map(p => [String(p.user_id), p]));
  let rows = (voters || []).map(v => ({ ...v, voted: map.has(String(v.id)), voted_at: map.get(String(v.id))?.voted_at || null }));
  const status = url.searchParams.get("status") || "all";
  if (status === "voted") rows = rows.filter(v => v.voted);
  if (status === "not-voted") rows = rows.filter(v => !v.voted);
  rows.sort(voterSort);
  return json({ election, voters: rows, votedCount: rows.filter(v => v.voted).length, notVotedCount: rows.filter(v => !v.voted).length });
}

async function getElectionData(env, electionId) {
  const sb = db(env);
  const { data: positions, error } = await sb.from("positions").select("id,title,seats,sort_order").eq("election_id", electionId).order("sort_order").order("id");
  assertDb(error);
  const ids = (positions || []).map(p => p.id);
  let candidates = [];
  if (ids.length) {
    const r = await sb.from("candidates").select("id,position_id,full_name,statement,sort_order,photo_path").in("position_id", ids).order("sort_order").order("id");
    if (r.error && candidatePhotoSchemaMissing(r.error)) {
      const fallback = await sb.from("candidates").select("id,position_id,full_name,statement,sort_order").in("position_id", ids).order("sort_order").order("id");
      assertDb(fallback.error); candidates = (fallback.data || []).map(publicCandidate);
    } else {
      assertDb(r.error); candidates = (r.data || []).map(publicCandidate);
    }
  }
  for (const p of positions || []) p.candidates = candidates.filter(c => Number(c.position_id) === Number(p.id));
  return { positions: positions || [] };
}

async function electionIsDraft(env, electionId) {
  const sb = db(env);
  const { data, error } = await sb.from("elections").select("status").eq("id", electionId).maybeSingle();
  assertDb(error);
  return data?.status === "draft";
}

async function audit(env, adminId, action, entityType, entityId, details) {
  const sb = db(env);
  const { error } = await sb.from("audit_log").insert({ admin_user_id: adminId || null, action, entity_type: entityType || null, entity_id: String(entityId ?? ""), details: details || {} });
  if (error) console.error("Audit log write failed", error);
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, fullName: u.full_name, block: u.block, lot: u.lot, mustChangePassword: u.role === "voter" && Boolean(u.must_change_password) };
}
function publicElection(e) {   return { id: e.id, title: e.title, isTest: Boolean(e.is_test), description: e.description, status: visibleElection(e).status,
    openedAt: e.opened_at, votingStartsAt: e.voting_starts_at, votingEndsAt: e.voting_ends_at }; }
function publicCandidate(c) {
  const { photo_path, ...rest } = c;
  return { ...rest, has_photo: Boolean(photo_path) };
}

async function readCandidateForm(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return { fullName: form.get("fullName"), statement: form.get("statement"), photo: form.get("photo") };
  }
  const body = await readJson(request);
  return { fullName: body?.fullName, statement: body?.statement, photo: null };
}

function isUploadedFile(value) {
  return Boolean(value && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.size === "number");
}

async function prepareCandidatePhoto(file) {
  if (file.size > MAX_CANDIDATE_PHOTO_BYTES) throw new Error("Candidate photo must be 5 MB or smaller.");
  const mime = String(file.type || "").toLowerCase();
  const allowed = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const ext = allowed[mime];
  if (!ext) throw new Error("Candidate photo must be a JPEG, PNG, or WebP image.");
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const valid = mime === "image/jpeg"
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === "image/png"
      ? bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((v,i) => bytes[i] === v)
      : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
  if (!valid) throw new Error("The selected file does not appear to be a valid image.");
  return { buffer, mime, ext };
}

async function uploadCandidatePhotoObject(sb, candidateId, prepared) {
  const path = `${candidateId}/${crypto.randomUUID()}.${prepared.ext}`;
  const { error } = await sb.storage.from(CANDIDATE_PHOTO_BUCKET).upload(path, prepared.buffer, {
    contentType: prepared.mime,
    cacheControl: "3600",
    upsert: false
  });
  return { path, error };
}

async function getCandidateForPhotoChange(sb, candidateId) {
  const { data: c, error } = await sb.from("candidates").select("id,full_name,position_id,photo_path").eq("id", candidateId).maybeSingle();
  if (error) {
    if (candidatePhotoSchemaMissing(error)) return { response: candidatePhotoConfigError(error) };
    assertDb(error);
  }
  if (!c) return { response: json({ error: "Candidate not found." }, 404) };
  const { data: p, error: pError } = await sb.from("positions").select("election_id").eq("id", c.position_id).single();
  assertDb(pError);
  return { fullName: c.full_name, electionId: p.election_id, photoPath: c.photo_path || null };
}

async function electionCandidatePhotoPaths(sb, electionId) {
  const { data: positions, error: pError } = await sb.from("positions").select("id").eq("election_id", electionId);
  assertDb(pError);
  const ids = (positions || []).map(p => p.id);
  if (!ids.length) return [];
  const { data, error } = await sb.from("candidates").select("photo_path").in("position_id", ids);
  if (error) {
    if (candidatePhotoSchemaMissing(error)) return [];
    assertDb(error);
  }
  return (data || []).map(c => c.photo_path).filter(Boolean);
}

async function removeCandidatePhotoObjects(sb, paths) {
  const cleanPaths = [...new Set((paths || []).filter(Boolean))];
  if (!cleanPaths.length) return;
  const { error } = await sb.storage.from(CANDIDATE_PHOTO_BUCKET).remove(cleanPaths);
  if (error && !/bucket not found|not found/i.test(error.message || "")) console.error("Candidate photo cleanup failed", error);
}

function candidatePhotoSchemaMissing(error) {
  const msg = String(error?.message || "");
  return /photo_path|schema cache/i.test(msg) && /does not exist|could not find|column/i.test(msg);
}
function candidatePhotoConfigError(error) {
  const msg = String(error?.message || "");
  if (candidatePhotoSchemaMissing(error) || /bucket not found|not found/i.test(msg)) {
    return json({ error: "Candidate photo storage is not configured yet. Run supabase/add-candidate-photos.sql in the Supabase SQL Editor, then try again." }, 409);
  }
  return json({ error: `Candidate photo upload failed: ${msg || "Storage error."}` }, 500);
}
function mimeFromPhotoPath(path) {
  const p = String(path || "").toLowerCase();
  if (p.endsWith(".png")) return "image/png";
  if (p.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function voterSort(a,b) {
  return String(a.block || "").localeCompare(String(b.block || ""), undefined, { numeric: true, sensitivity: "base" }) ||
    String(a.lot || "").localeCompare(String(b.lot || ""), undefined, { numeric: true, sensitivity: "base" }) ||
    String(a.full_name || "").localeCompare(String(b.full_name || ""), undefined, { sensitivity: "base" });
}
function countBy(rows, key) {
  const map = new Map();
  for (const r of rows) { const k = String(r[key]); map.set(k, (map.get(k) || 0) + 1); }
  return map;
}
function assertDb(error) { if (error) throw new Error(`Database error: ${error.message || error}`); }
function isUnique(error) { return error?.code === "23505" || /duplicate key|unique/i.test(error?.message || ""); }
function dbConflict(error) {
  const msg = error?.message || "Database update failed.";
  if (/locked once voting opens|draft/i.test(msg)) return json({ error: msg }, 409);
  throw new Error(`Database error: ${msg}`);
}
function friendlyError(error) {
  const msg = String(error?.message || error || "Unexpected server error.");
  if (msg.startsWith("Supabase is not configured")) return msg;
  if (msg.includes("Could not find the function")) return "Supabase schema is incomplete. Run supabase/schema.sql in the Supabase SQL Editor.";
  if (/photo_path|candidate-photos/i.test(msg)) return "Candidate photo storage is not configured yet. Run supabase/add-candidate-photos.sql in the Supabase SQL Editor.";
  return "Unexpected server error.";
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,"0")).join("");
}
function randomString(length) { return randomFromAlphabet(length, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"); }
function strongVoterPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const nums = "23456789";
  const chars = [pick(upper), pick(lower), pick(nums)];
  while (chars.length < 12) chars.push(pick(upper + lower + nums));
  for (let i = chars.length - 1; i > 0; i--) { const j = secureInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}
function randomFromAlphabet(length, alphabet) { let out=""; for (let i=0;i<length;i++) out += alphabet[secureInt(alphabet.length)]; return out; }
function pick(str) { return str[secureInt(str.length)]; }
function secureInt(max) { const arr = new Uint32Array(1); const limit = Math.floor(0x100000000 / max) * max; do crypto.getRandomValues(arr); while (arr[0] >= limit); return arr[0] % max; }
function timingSafeEqual(a,b) { a=String(a||""); b=String(b||""); if (a.length !== b.length) return false; let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
function clean(value, max=200) { return String(value ?? "").trim().replace(/[\u0000-\u001F\u007F]/g, "").slice(0,max); }
function getCookie(request, name) { const cookie=request.headers.get("cookie")||""; for(const p of cookie.split(";")){ const [k,...rest]=p.trim().split("="); if(k===name) return rest.join("="); } return null; }
async function readJson(request, maxBytes = 256 * 1024) {
  // Limit request bodies even when the client omits Content-Length. This avoids
  // asking the Worker to buffer and parse arbitrarily large JSON payloads.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes || !request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch { return null; }
}
function secureJsonHeaders() { return new Headers({ "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "x-content-type-options":"nosniff", "referrer-policy":"no-referrer", "permissions-policy":"camera=(), microphone=(), geolocation=()", "content-security-policy":"default-src 'none'; frame-ancestors 'none'" }); }
function json(data, status=200) { return new Response(JSON.stringify(data), { status, headers: secureJsonHeaders() }); }
