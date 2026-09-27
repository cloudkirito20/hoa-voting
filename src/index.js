import { createClient } from "@supabase/supabase-js";

const enc = new TextEncoder();
const SESSION_COOKIE = "hoa_session";
const SESSION_SECONDS = 12 * 60 * 60;

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
    return env.ASSETS.fetch(request);
  }
};

function db(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "hoa-voting-cloudflare-worker/2.0" } }
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

  if (path === "/api/voter/ballot" && method === "GET") return voterBallot(env, auth.user);
  if (path === "/api/voter/vote" && method === "POST") return submitVote(request, env, auth.user);

  if (auth.user.role !== "admin") return json({ error: "Administrator access required." }, 403);

  if (path === "/api/admin/overview" && method === "GET") return adminOverview(env);
  if (path === "/api/admin/elections" && method === "GET") return listElections(env);
  if (path === "/api/admin/elections" && method === "POST") return createElection(request, env, auth.user);
  if (/^\/api\/admin\/elections\/\d+$/.test(path) && method === "GET") return getElection(env, Number(path.split("/").pop()));
  if (/^\/api\/admin\/elections\/\d+$/.test(path) && method === "DELETE") return deleteElection(request, env, auth.user, Number(path.split("/").pop()));
  if (/^\/api\/admin\/elections\/\d+\/status$/.test(path) && method === "PUT") return updateElectionStatus(request, env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/elections\/\d+\/positions$/.test(path) && method === "POST") return addPosition(request, env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/positions\/\d+$/.test(path) && method === "DELETE") return deletePosition(env, auth.user, Number(path.split("/").pop()));
  if (/^\/api\/admin\/positions\/\d+\/candidates$/.test(path) && method === "POST") return addCandidate(request, env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/candidates\/\d+$/.test(path) && method === "DELETE") return deleteCandidate(env, auth.user, Number(path.split("/").pop()));

  if (path === "/api/admin/voters" && method === "GET") return listVoters(env, url);
  if (path === "/api/admin/voters" && method === "POST") return createVoter(request, env, auth.user);
  if (/^\/api\/admin\/voters\/\d+\/reset-password$/.test(path) && method === "POST") return resetVoterPassword(env, auth.user, Number(path.split("/")[4]));
  if (/^\/api\/admin\/voters\/\d+\/active$/.test(path) && method === "PUT") return toggleVoter(request, env, auth.user, Number(path.split("/")[4]));

  if (/^\/api\/admin\/elections\/\d+\/results$/.test(path) && method === "GET") return electionResults(env, Number(path.split("/")[4]));
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
  if (!fullName || username.length < 4 || password.length < 10) return json({ error: "Provide an admin name, username (4+ characters), and password (10+ characters)." }, 400);

  const { error } = await sb.rpc("hoa_create_user", {
    p_username: username,
    p_password: password,
    p_role: "admin",
    p_full_name: fullName,
    p_block: null,
    p_lot: null
  });
  if (error) {
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

  const cutoff15 = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const cutoffDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await sb.from("login_attempts").delete().lt("attempted_at", cutoffDay);
  const { count: recent, error: recentError } = await sb.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).gte("attempted_at", cutoff15);
  assertDb(recentError);
  if (Number(recent || 0) >= 10) return json({ error: "Too many failed login attempts. Please try again later." }, 429);

  const { data, error } = await sb.rpc("hoa_verify_login", { p_username: username, p_password: password });
  assertDb(error);
  const user = Array.isArray(data) ? data[0] : data;
  if (!user) {
    const { error: attemptError } = await sb.from("login_attempts").insert({ ip, username });
    assertDb(attemptError);
    return json({ error: "Invalid username or password." }, 401);
  }

  await sb.from("login_attempts").delete().eq("ip", ip);
  const token = randomString(48);
  const tokenHash = await sha256(token);
  const csrfToken = randomString(32);
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  const { error: sessionError } = await sb.from("sessions").insert({ token_hash: tokenHash, user_id: user.id, csrf_token: csrfToken, expires_at: expiresAt });
  assertDb(sessionError);

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
  const { data: user, error: userError } = await sb.from("users").select("id,username,role,full_name,block,lot,active").eq("id", session.user_id).maybeSingle();
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
    sb.from("elections").select("id", { count: "exact", head: true }).eq("status", "open"),
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
  return json({ elections: (elections || []).map(e => ({ ...e, position_count: pCounts.get(String(e.id)) || 0, ballots: bCounts.get(String(e.id)) || 0 })) });
}

async function createElection(request, env, admin) {
  const sb = db(env);
  const body = await readJson(request);
  const title = clean(body?.title, 120);
  const description = clean(body?.description, 500);
  if (!title) return json({ error: "Election title is required." }, 400);
  const { data, error } = await sb.from("elections").insert({ title, description: description || null, created_by: admin.id }).select("id").single();
  assertDb(error);
  await audit(env, admin.id, "election.create", "election", data.id, { title });
  return json({ ok: true, id: data.id }, 201);
}

async function deleteElection(request, env, admin, electionId) {
  const sb = db(env);
  const body = await readJson(request);
  const confirmTitle = String(body?.confirmTitle || "").trim();
  const { data: election, error } = await sb.from("elections").select("id,title,status").eq("id", electionId).maybeSingle();
  assertDb(error);
  if (!election) return json({ error: "Election not found." }, 404);
  if (election.status === "open") return json({ error: "An open election cannot be deleted. Close voting first." }, 409);
  if (!confirmTitle || confirmTitle !== election.title) return json({ error: "Type the exact election title to confirm permanent deletion." }, 400);

  const { data, error: deleteError } = await sb.rpc("hoa_delete_election", { p_election_id: electionId });
  if (deleteError) {
    const msg = deleteError.message || "Unable to delete election.";
    if (/open election/i.test(msg)) return json({ error: "An open election cannot be deleted. Close voting first." }, 409);
    assertDb(deleteError);
  }
  return json({ ok: true, deleted: data || { id: election.id, title: election.title } });
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
    assertDb(r.error); candidates = r.data || [];
  }
  for (const p of positions || []) p.candidates = candidates.filter(c => Number(c.position_id) === Number(p.id));
  return json({ election, positions: positions || [] });
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
  if (status === "closed") patch.closed_at = new Date().toISOString();
  const { error: updateError } = await sb.from("elections").update(patch).eq("id", electionId);
  if (updateError) {
    if (isUnique(updateError)) return json({ error: "Another election is already open." }, 409);
    assertDb(updateError);
  }
  await audit(env, admin.id, "election.status", "election", electionId, { from: election.status, to: status });
  return json({ ok: true });
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
  const r = await sb.from("positions").delete().eq("id", positionId);
  if (r.error) return dbConflict(r.error);
  await audit(env, admin.id, "position.delete", "position", positionId, { title: p.title });
  return json({ ok: true });
}

async function addCandidate(request, env, admin, positionId) {
  const sb = db(env);
  const { data: p, error } = await sb.from("positions").select("id,election_id").eq("id", positionId).maybeSingle();
  assertDb(error);
  if (!p) return json({ error: "Position not found." }, 404);
  if (!(await electionIsDraft(env, p.election_id))) return json({ error: "Candidates are locked once voting opens." }, 409);
  const body = await readJson(request);
  const fullName = clean(body?.fullName, 100);
  const statement = clean(body?.statement, 400);
  if (!fullName) return json({ error: "Candidate name is required." }, 400);
  const { data: existing, error: orderError } = await sb.from("candidates").select("sort_order").eq("position_id", positionId).order("sort_order", { ascending: false }).limit(1);
  assertDb(orderError);
  const sortOrder = Number(existing?.[0]?.sort_order || 0) + 1;
  const { data, error: insertError } = await sb.from("candidates").insert({ position_id: positionId, full_name: fullName, statement: statement || null, sort_order: sortOrder }).select("id").single();
  if (insertError) {
    if (isUnique(insertError)) return json({ error: "That candidate is already listed for this position." }, 409);
    return dbConflict(insertError);
  }
  await audit(env, admin.id, "candidate.create", "candidate", data.id, { positionId, fullName });
  return json({ ok: true, id: data.id }, 201);
}

async function deleteCandidate(env, admin, candidateId) {
  const sb = db(env);
  const { data: c, error } = await sb.from("candidates").select("id,full_name,position_id").eq("id", candidateId).maybeSingle();
  assertDb(error);
  if (!c) return json({ error: "Candidate not found." }, 404);
  const { data: p, error: pError } = await sb.from("positions").select("election_id").eq("id", c.position_id).single();
  assertDb(pError);
  if (!(await electionIsDraft(env, p.election_id))) return json({ error: "Candidates are locked once voting opens." }, 409);
  const r = await sb.from("candidates").delete().eq("id", candidateId);
  if (r.error) return dbConflict(r.error);
  await audit(env, admin.id, "candidate.delete", "candidate", candidateId, { fullName: c.full_name });
  return json({ ok: true });
}

async function listVoters(env, url) {
  const sb = db(env);
  const search = clean(url.searchParams.get("search"), 80).toLowerCase();
  const electionId = Number(url.searchParams.get("electionId") || 0);
  const { data: voters, error } = await sb.from("users").select("id,username,full_name,block,lot,active,created_at").eq("role", "voter");
  assertDb(error);
  let participation = [];
  if (electionId) {
    const r = await sb.from("voter_participation").select("user_id,voted_at").eq("election_id", electionId);
    assertDb(r.error); participation = r.data || [];
  }
  const pMap = new Map(participation.map(p => [String(p.user_id), p]));
  let rows = (voters || []).map(v => ({ ...v, voted: pMap.has(String(v.id)), voted_at: pMap.get(String(v.id))?.voted_at || null }));
  if (search) rows = rows.filter(v => [v.full_name, v.username, v.block, v.lot].some(x => String(x || "").toLowerCase().includes(search)));
  rows.sort(voterSort);
  return json({ voters: rows });
}

async function createVoter(request, env, admin) {
  const sb = db(env);
  const body = await readJson(request);
  const fullName = clean(body?.fullName, 100);
  const block = clean(body?.block, 40);
  const lot = clean(body?.lot, 40);
  if (!fullName || !block || !lot) return json({ error: "Full name, block, and lot are required." }, 400);

  let username = null;
  for (let i = 0; i < 12; i++) {
    const candidate = `HOA-${randomFromAlphabet(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")}`;
    const { count, error } = await sb.from("users").select("id", { count: "exact", head: true }).ilike("username", candidate);
    assertDb(error);
    if (!count) { username = candidate; break; }
  }
  if (!username) return json({ error: "Could not generate a unique username. Try again." }, 500);

  const password = strongEightCharPassword();
  const { data: id, error } = await sb.rpc("hoa_create_user", {
    p_username: username,
    p_password: password,
    p_role: "voter",
    p_full_name: fullName,
    p_block: block,
    p_lot: lot
  });
  if (error) {
    if (isUnique(error)) return json({ error: "Generated username collision. Please try again." }, 409);
    assertDb(error);
  }
  await audit(env, admin.id, "voter.create", "user", id, { username, fullName, block, lot });
  return json({ ok: true, voter: { id, username, password, fullName, block, lot } }, 201);
}

async function resetVoterPassword(env, admin, voterId) {
  const sb = db(env);
  const { data: voter, error } = await sb.from("users").select("id,username,full_name").eq("id", voterId).eq("role", "voter").maybeSingle();
  assertDb(error);
  if (!voter) return json({ error: "Voter not found." }, 404);
  const password = strongEightCharPassword();
  const r = await sb.rpc("hoa_reset_password", { p_user_id: voterId, p_password: password });
  assertDb(r.error);
  if (!r.data) return json({ error: "Voter not found." }, 404);
  await audit(env, admin.id, "voter.password_reset", "user", voterId, { username: voter.username });
  return json({ ok: true, username: voter.username, password, fullName: voter.full_name });
}

async function toggleVoter(request, env, admin, voterId) {
  const sb = db(env);
  const body = await readJson(request);
  const active = Boolean(body?.active);
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
  const { data: elections, error } = await sb.from("elections").select("*").eq("status", "open").order("opened_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  assertDb(error);
  const election = elections?.[0];
  if (!election) return json({ election: null, message: "There is no open election right now." });
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
  const { data: election, error } = await sb.from("elections").select("id,status").eq("id", electionId).eq("status", "open").maybeSingle();
  assertDb(error);
  if (!election) return json({ error: "This election is not open." }, 409);
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
    if (/not open/i.test(msg)) return json({ error: "This election is not open." }, 409);
    if (/invalid|too many|select at least/i.test(msg)) return json({ error: msg.replace(/^.*?:\s*/, "") }, 400);
    assertDb(voteError);
  }
  return json({ ok: true, receiptCode: data || receiptCode });
}

async function electionResults(env, electionId) {
  const sb = db(env);
  const { data: election, error } = await sb.from("elections").select("*").eq("id", electionId).maybeSingle();
  assertDb(error);
  if (!election) return json({ error: "Election not found." }, 404);

  const [{ count: eligible, error: eError }, { count: ballotsCast, error: tError }, detail, votesR] = await Promise.all([
    sb.from("users").select("id", { count: "exact", head: true }).eq("role", "voter").eq("active", true),
    sb.from("voter_participation").select("user_id", { count: "exact", head: true }).eq("election_id", electionId),
    getElectionData(env, electionId),
    sb.from("ballot_votes").select("candidate_id").eq("election_id", electionId)
  ]);
  assertDb(eError); assertDb(tError); assertDb(votesR.error);
  const voteCounts = countBy(votesR.data || [], "candidate_id");
  for (const p of detail.positions) {
    let totalVotes = 0;
    const candidates = p.candidates.map(c => {
      const votes = voteCounts.get(String(c.id)) || 0;
      totalVotes += votes;
      return { ...c, votes };
    }).sort((a,b) => b.votes - a.votes || a.full_name.localeCompare(b.full_name));
    p.totalVotes = totalVotes;
    p.candidates = candidates.map(c => ({ ...c, percentage: totalVotes ? Number(((c.votes / totalVotes) * 100).toFixed(1)) : 0 }));
  }
  const eligibleVoters = Number(eligible || 0);
  const cast = Number(ballotsCast || 0);
  return json({ election, eligibleVoters, ballotsCast: cast, turnoutPercentage: eligibleVoters ? Number(((cast / eligibleVoters) * 100).toFixed(1)) : 0, positions: detail.positions });
}

async function participationReport(env, electionId, url) {
  const sb = db(env);
  const { data: election, error } = await sb.from("elections").select("id,title,status").eq("id", electionId).maybeSingle();
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
    const r = await sb.from("candidates").select("id,position_id,full_name,statement,sort_order").in("position_id", ids).order("sort_order").order("id");
    assertDb(r.error); candidates = r.data || [];
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
  return { id: u.id, username: u.username, role: u.role, fullName: u.full_name, block: u.block, lot: u.lot };
}
function publicElection(e) { return { id: e.id, title: e.title, description: e.description, status: e.status, openedAt: e.opened_at }; }

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
  return "Unexpected server error.";
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,"0")).join("");
}
function randomString(length) { return randomFromAlphabet(length, "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"); }
function strongEightCharPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const nums = "23456789";
  const chars = [pick(upper), pick(lower), pick(nums)];
  while (chars.length < 8) chars.push(pick(upper + lower + nums));
  for (let i = chars.length - 1; i > 0; i--) { const j = secureInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}
function randomFromAlphabet(length, alphabet) { let out=""; for (let i=0;i<length;i++) out += alphabet[secureInt(alphabet.length)]; return out; }
function pick(str) { return str[secureInt(str.length)]; }
function secureInt(max) { const arr = new Uint32Array(1); const limit = Math.floor(0x100000000 / max) * max; do crypto.getRandomValues(arr); while (arr[0] >= limit); return arr[0] % max; }
function timingSafeEqual(a,b) { a=String(a||""); b=String(b||""); if (a.length !== b.length) return false; let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
function clean(value, max=200) { return String(value ?? "").trim().replace(/[\u0000-\u001F\u007F]/g, "").slice(0,max); }
function getCookie(request, name) { const cookie=request.headers.get("cookie")||""; for(const p of cookie.split(";")){ const [k,...rest]=p.trim().split("="); if(k===name) return rest.join("="); } return null; }
async function readJson(request) { try { return await request.json(); } catch { return null; } }
function secureJsonHeaders() { return new Headers({ "content-type":"application/json; charset=utf-8", "cache-control":"no-store", "x-content-type-options":"nosniff", "referrer-policy":"no-referrer", "permissions-policy":"camera=(), microphone=(), geolocation=()", "content-security-policy":"default-src 'none'; frame-ancestors 'none'" }); }
function json(data, status=200) { return new Response(JSON.stringify(data), { status, headers: secureJsonHeaders() }); }
