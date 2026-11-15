const DISCOVERY_PATH = "/sap/bc/adt/discovery";
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_CREATE_SOURCE_BYTES = 200_000;

function readConfig(env = process.env) {
  const baseUrl = (env.SAP_ADT_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!baseUrl) return { configured: false };
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error("SAP_ADT_BASE_URL must be a valid absolute URL"); }
  const httpAllowed = env.SAP_ADT_ALLOW_HTTP === "true";
  if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && httpAllowed)) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("SAP_ADT_BASE_URL must use HTTPS, or HTTP with SAP_ADT_ALLOW_HTTP=true, and must not contain embedded credentials, query, or fragment");
  }
  return {
    configured: true,
    baseUrl,
    username: env.SAP_ADT_USERNAME || env.SAP_ODATA_USERNAME || "",
    password: env.SAP_ADT_PASSWORD || env.SAP_ODATA_PASSWORD || "",
    client: env.SAP_ADT_CLIENT || env.SAP_ODATA_CLIENT || "",
    timeoutMs: Math.max(1000, Math.min(Number(env.SAP_ADT_TIMEOUT_MS) || 8000, 30000))
  };
}

/** Performs an explicit, read-only ADT discovery request. It never writes SAP data. */
export async function checkSapAdtConnection(env = process.env, fetchImpl = fetch) {
  const config = readConfig(env);
  if (!config.configured) return { configured: false, state: "not-configured", message: "SAP ADT is not configured; JDAP remains in mock SAP mode." };
  const transport = new URL(config.baseUrl).protocol.slice(0, -1).toUpperCase();
  if (!config.username || !config.password) return { configured: true, state: "missing-credentials", transport, message: "SAP ADT URL is configured, but username/password are missing." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers = {
    Accept: "application/atomsvc+xml, application/xml, text/xml",
    Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`
  };
  if (config.client) headers["sap-client"] = config.client;
  try {
    const response = await fetchImpl(`${config.baseUrl}${DISCOVERY_PATH}`, {
      method: "GET", headers, signal: controller.signal, redirect: "manual"
    });
    if (response.status >= 200 && response.status < 300) {
      return { configured: true, state: "reachable", transport, httpStatus: response.status, checkedAt: new Date().toISOString(), message: "SAP ADT discovery endpoint responded. This confirms endpoint reachability only." };
    }
    const state = response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 404 ? "adt-not-found" : "http-error";
    return { configured: true, state, transport, httpStatus: response.status, checkedAt: new Date().toISOString(), message: `SAP ADT discovery returned HTTP ${response.status}.` };
  } catch (error) {
    const timeout = error?.name === "AbortError";
    return { configured: true, state: timeout ? "timeout" : "unreachable", transport, checkedAt: new Date().toISOString(), message: timeout ? "SAP ADT request timed out." : "Could not reach SAP ADT. Check the configured HTTP/HTTPS route, network, and SAP ICF service." };
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_SOURCE_BYTES) throw new Error("SAP source response exceeded the 1 MiB limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SOURCE_BYTES) {
        await reader.cancel();
        throw new Error("SAP source response exceeded the 1 MiB limit");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Reads the main source of one ABAP program. This function only issues GET requests. */
export async function readAbapProgramSource(programName, env = process.env, fetchImpl = fetch) {
  const config = readConfig(env);
  if (!config.configured) return { ok: false, status: 409, state: "not-configured", message: "SAP ADT is not configured." };
  if (!config.username || !config.password) return { ok: false, status: 409, state: "missing-credentials", message: "SAP ADT credentials are not configured." };
  const normalizedName = String(programName || "").trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,40}$/.test(normalizedName)) return { ok: false, status: 400, state: "invalid-program-name", message: "Use an ABAP program name containing only A-Z, 0-9, and underscore (1–40 characters)." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const headers = {
    Accept: "text/plain",
    Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`
  };
  if (config.client) headers["sap-client"] = config.client;
  const sourcePath = `/sap/bc/adt/programs/programs/${encodeURIComponent(normalizedName.toLowerCase())}/source/main`;
  try {
    const response = await fetchImpl(`${config.baseUrl}${sourcePath}`, { method: "GET", headers, signal: controller.signal, redirect: "manual" });
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status === 401 || response.status === 403 ? 403 : response.status === 404 ? 404 : 502;
      return { ok: false, status, state: response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 404 ? "program-not-found" : "sap-http-error", message: `SAP ADT source request returned HTTP ${response.status}.` };
    }
    const source = await readLimitedText(response);
    return { ok: true, programName: normalizedName, source, transport: new URL(config.baseUrl).protocol.slice(0, -1).toUpperCase(), retrievedAt: new Date().toISOString(), note: "Read from SAP ADT. JDAP made no SAP changes." };
  } catch (error) {
    const tooLarge = /exceeded the 1 MiB limit/.test(error?.message || "");
    const timeout = error?.name === "AbortError";
    return { ok: false, status: tooLarge ? 413 : 502, state: tooLarge ? "source-too-large" : timeout ? "timeout" : "unreachable", message: tooLarge ? error.message : timeout ? "SAP ADT request timed out." : "Could not retrieve source from SAP ADT. Check the configured HTTP/HTTPS route, network, and SAP authorizations." };
  } finally { clearTimeout(timer); }
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]);
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") || "").split(/,\s*(?=[^;,\s]+=)/);
  return values.map(value => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function mergeCookieHeaders(current, response) {
  const cookies = new Map((current || "").split(/;\s*/).filter(Boolean).map(pair => [pair.slice(0, pair.indexOf("=")), pair]));
  for (const pair of cookieHeader(response).split(/;\s*/).filter(Boolean)) cookies.set(pair.slice(0, pair.indexOf("=")), pair);
  return [...cookies.values()].join("; ");
}

async function ensureOk(response, action) {
  if (response.ok) return;
  const text = (await response.text()).slice(0, 1200);
  throw new Error(`SAP ${action} returned HTTP ${response.status}${text ? `: ${text}` : ""}`);
}

/** Creates a new report in $TMP and saves source inactive. This issues POST/PUT requests; it never activates. */
export async function createInactiveAbapProgram({ programName, description, source, approvalId }, env = process.env, fetchImpl = fetch) {
  const config = readConfig(env);
  if (!config.configured) return { ok: false, status: 409, state: "not-configured", message: "SAP ADT is not configured." };
  if (!config.username || !config.password) return { ok: false, status: 409, state: "missing-credentials", message: "SAP ADT credentials are not configured." };
  const name = String(programName || "").trim().toUpperCase();
  const text = String(description || "").trim();
  if (!/^Z[A-Z0-9_]{1,39}$/.test(name)) return { ok: false, status: 400, state: "invalid-program-name", message: "Use a customer program name beginning with Z (2–40 characters, A–Z, 0–9, underscore)." };
  if (!text || text.length > 60) return { ok: false, status: 400, state: "invalid-description", message: "Description must contain 1–60 characters." };
  if (typeof source !== "string" || !source.trim() || Buffer.byteLength(source, "utf8") > MAX_CREATE_SOURCE_BYTES) return { ok: false, status: 400, state: "invalid-source", message: "ABAP source is required and must not exceed 200,000 bytes." };
  const declaration = source.match(/^\s*(REPORT|PROGRAM)\s+([A-Z0-9_]+)/im);
  if (!declaration) return { ok: false, status: 400, state: "invalid-source", message: "Source must declare a REPORT or PROGRAM." };
  if (declaration[2].toUpperCase() !== name) return { ok: false, status: 400, state: "program-name-mismatch", message: `The source declares ${declaration[2]}, but the requested SAP object name is ${name}.` };
  if (!approvalId) return { ok: false, status: 400, state: "approval-required", message: "An approved JDAP draft is required." };

  const base = config.baseUrl;
  const auth = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  const common = { Authorization: auth, Accept: "application/xml, text/xml", "sap-adt-sessiontype": "stateful" };
  if (config.client) common["sap-client"] = config.client;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let created = false;
  let lockHandle = "";
  let cookie = "";
  let csrf = "";
  let securitySessionMode = "create";
  const csrfProbeStatuses = [];
  const request = async (path, options = {}) => fetchImpl(`${base}${path}`, {
    ...options,
    signal: controller.signal,
    redirect: "manual",
    headers: { ...common, "x-sap-security-session": securitySessionMode, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}), ...(options.headers || {}) }
  });
  try {
    const readToken = async (path, accept) => {
      const response = await request(path, { method: "GET", headers: { "x-csrf-token": "Fetch", Accept: accept } });
      const status = response.status;
      csrfProbeStatuses.push(`${path} HTTP ${status}`);
      const token = response.headers.get("x-csrf-token") || "";
      cookie = mergeCookieHeaders(cookie, response);
      await response.body?.cancel();
      return { status, token };
    };
    let tokenResult = await readToken("/sap/bc/adt/core/http/sessions", "application/vnd.sap.adt.core.http.session.v3+xml, application/xml");
    csrf = tokenResult.token;
    if (!csrf) {
      // sap-usercontext carries the client selection; it does not prove that ADT opened a security session.
      // When the session resource is unavailable on classic NetWeaver, explicitly create on discovery.
      securitySessionMode = "create";
      tokenResult = await readToken(DISCOVERY_PATH, "application/atomsvc+xml, application/xml, text/xml");
      csrf = tokenResult.token;
    }
    if (csrf.trim().toLowerCase() === "required" || csrf.trim().toLowerCase() === "fetch") csrf = "";
    if (!csrf) throw new Error(`SAP ADT did not return an X-CSRF-Token; no object was created. Token checks: ${csrfProbeStatuses.join("; ")}.`);
    securitySessionMode = "use";

    const lower = name.toLowerCase();
    const existing = await request(`/sap/bc/adt/programs/programs/${lower}/source/main`, { method: "GET", headers: { Accept: "text/plain" } });
    if (existing.status === 200) {
      await existing.body?.cancel();
      return { ok: false, status: 409, state: "program-already-exists", message: `SAP program ${name} already exists. JDAP did not change it.` };
    }
    await existing.body?.cancel();
    if (existing.status !== 404) throw new Error(`SAP program existence check returned HTTP ${existing.status}; no object was created.`);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<program:abapProgram xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:type="PROG/P" adtcore:description="${escapeXml(text)}" adtcore:language="EN" adtcore:name="${name}" adtcore:masterLanguage="EN" adtcore:responsible="${escapeXml(config.username.toUpperCase())}"><adtcore:packageRef adtcore:name="$TMP"/></program:abapProgram>`;
    const createResponse = await request("/sap/bc/adt/programs/programs", { method: "POST", body: xml, headers: { "Content-Type": "application/vnd.sap.adt.programs.programs+xml; charset=utf-8", Accept: "application/vnd.sap.adt.programs.programs+xml" } });
    await ensureOk(createResponse, "program creation");
    await createResponse.body?.cancel();
    created = true;
    const lockResponse = await request(`/sap/bc/adt/programs/programs/${lower}?_action=LOCK&accessMode=MODIFY`, { method: "POST", body: "" });
    await ensureOk(lockResponse, "program lock");
    const lockXml = await lockResponse.text();
    lockHandle = lockXml.match(/<(?:\w+:)?LOCK_HANDLE>([^<]+)<\/(?:\w+:)?LOCK_HANDLE>/i)?.[1] || lockXml.match(/lockHandle="([^"]+)"/i)?.[1] || "";
    if (!lockHandle) throw new Error("SAP created the object but did not return a lock handle; source was not saved and the object remains incomplete.");

    const sourceResponse = await request(`/sap/bc/adt/programs/programs/${lower}/source/main?lockHandle=${encodeURIComponent(lockHandle)}`, { method: "PUT", body: source, headers: { "Content-Type": "text/plain; charset=utf-8", Accept: "text/plain" } });
    await ensureOk(sourceResponse, "source save");
    await sourceResponse.body?.cancel();

    const unlockResponse = await request(`/sap/bc/adt/programs/programs/${lower}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`, { method: "POST", body: "" });
    lockHandle = "";
    await ensureOk(unlockResponse, "program unlock");
    await unlockResponse.body?.cancel();
    return { ok: true, state: "saved-inactive", programName: name, package: "$TMP", approvalId, activated: false, message: "The report and source were saved in $TMP as an inactive object. JDAP did not activate or transport it." };
  } catch (error) {
    if (lockHandle) {
      try { await request(`/sap/bc/adt/programs/programs/${name.toLowerCase()}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`, { method: "POST", body: "" }); } catch { /* leave SAP error in primary response */ }
    }
    const timeout = error?.name === "AbortError";
    return { ok: false, status: timeout ? 504 : 502, state: created ? "partial-create" : timeout ? "timeout" : "sap-request-failed", created, programName: created ? name : undefined, activated: false, message: timeout ? (created ? "SAP request timed out after object creation began; check SAP ADT before retrying." : "SAP ADT request timed out; no object was created.") : error.message };
  } finally { clearTimeout(timer); }
}
