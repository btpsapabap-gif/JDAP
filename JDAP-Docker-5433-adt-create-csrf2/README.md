# JDAP — Joule Developer Agent Platform

A local SAP developer-agent workbench. It includes a React UI, Node.js API, 12 specialist agents, a multi-agent orchestrator, PostgreSQL persistence, an OpenAI-compatible model adapter, ECC/S/4HANA/BTP demo profiles, a read-only SAP OData adapter with opt-in workflow context, and an offline ABAP grammar check.

> **Connectivity status:** SAP OData metadata and explicit read-only entity-set/sample requests are live when configured. SAP ADT supports opt-in source reads and a separately gated, one-object ABAP report creation flow. Report creation saves to `$TMP` as inactive; JDAP does not activate or transport it.

## Backend module layout
- `backend/src/api`: startup entry point plus separate health, catalog, workflow, artifact, and audit route modules
- `backend/src/agents`: shared runner/registry plus 12 specialist-owned folders and mock response handlers
- `backend/src/orchestrator`: workflow sequencing and bounded agent handoffs
- `backend/src/integrations/openai`: OpenAI model client
- `backend/src/integrations/sap-ecc`, `sap-s4`, `sap-btp`: mock system profiles and fixtures
- `backend/src/integrations/sap-adt`: opt-in read-only SAP ADT discovery and ABAP program source reads
- `backend/src/integrations/sap-odata`: read-only SAP Gateway OData V2 metadata and explicit entity-set checks
- `backend/src/integrations/abap-static`: offline ABAP grammar checking against a selected on-premise release
- `backend/src/audit` and `backend/src/security`: audit persistence and provider selection policy
- `backend/src/mcp`, `backend/src/knowledge`, `backend/src/integrations/git`: reserved boundaries; integrations are not implemented yet
- `database/migrations` and `database/seed`: repeatable schema setup and separate demo data

## Frontend module layout
- `frontend/src/App.jsx`: shared application state and page routing
- `frontend/src/components`: navigation, status bar, agent lists, and system cards
- `frontend/src/pages`: AI Developer, Workflow History, Approvals, Testing Center, and registered-module views
- `frontend/src/pages/TestingCenter.jsx`: ABAP grammar check for generated or pasted source
- `frontend/src/dashboard`, `frontend/src/chat`, `frontend/src/agents`: dashboard cards, task composer, and agent directory modules
- `frontend/src/main.jsx`: browser entry point and stylesheet loading

## Requirements
- Docker Desktop running with Docker Compose
- No separate Windows PostgreSQL installation is required; Compose starts the JDAP PostgreSQL container

## Windows quick start (Docker Desktop)

1. Extract this ZIP. In File Explorer, open the extracted `JDAP-Docker-5433` folder and enter `powershell` in the address bar to open PowerShell there.
2. Create the environment file:
   ```powershell
   Copy-Item .env.example .env
   ```
3. Leave `AI_PROVIDER=mock` for offline mock mode. No API key is needed for that mode.
4. Start the complete stack:
   ```powershell
   docker compose up --build -d
   ```
5. Check that all services are running:
   ```powershell
   docker compose ps
   docker compose logs --tail 50 backend
   ```
   Wait for `JDAP database schema is ready` and `JDAP API listening on 4001` in the backend log.
6. Open **http://localhost:4000**. API health: **http://localhost:4001/api/health**.

The Compose PostgreSQL container is reachable by the backend at `postgres:5432` inside Docker. Its optional Windows host mapping is `localhost:5433` (database `jdap`, user/password `jdap`); this does not change the backend connection. If host port 5433 is already occupied, change the left side of `5433:5432` in `docker-compose.yml` to a free port such as `5434:5432`, then run `docker compose up -d` again.

To stop the stack, run `docker compose down`. This keeps the database volume. To also erase all JDAP database data, run `docker compose down -v`.

## First run
- The database schema is initialized from `database/migrations/001_init.sql`; demo rows are kept separately in `database/seed/001_demo.sql`.
- The UI seeds the demo project and system profiles through the API on first use.
- Select a mock system (`ECC 6.0`, `S/4HANA`, or `BTP`) and submit a development task.
- The workflow returns a plan, agent activity, generated draft artifact, review findings and test scenarios. The AI Developer page shows live specialist status; mock-mode steps are paced for a visible demo (`MOCK_AGENT_STEP_DELAY_MS`, default 200 ms). Agents receive bounded handoffs from relevant earlier specialists so reviews and tests can respond to the architecture and implementation drafts. Open **Workflow History** to revisit agent activity and download the latest 100 saved drafts.
- Open **Testing Center** to load the latest generated ABAP draft from the current session or saved history, or paste source. The default grammar target is SAP_BASIS 7.50 for the connected ECC/NetWeaver system.
- In **Workflow History**, open a saved draft and request a local review. The persisted **Approvals** queue records a reviewer decision and audit event. This is a local governance checkpoint only; approval does not call SAP or create, activate, transport, or deploy an object.
- Approved drafts can be exported from **Approvals** as a JSON handoff containing the saved draft, extracted ABAP source when present, and the review record. It is for manual developer handling; JDAP does not create a SAP repository object or transport from this export.
- Artifacts are drafts only. No SAP object is created, activated, transported or deployed.

## OpenAI model configuration

The AI provider and SAP connection are separate. To use OpenAI for the agent responses while keeping the SAP landscape in mock mode, set these values in `.env`:
```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4.1-mini
```
Then rebuild the backend with `docker compose up -d --build --force-recreate backend`. The app header will show `AI: OPENAI` and `SAP: MOCK`. With `AI_PROVIDER=mock`, it shows `AI: MOCK` and `SAP: MOCK`. The OpenAI adapter uses the Responses API. If a model call fails, the workflow reports the error instead of silently claiming a successful AI response. Only send code and data to OpenAI when your organization's policies permit it.

If OpenAI returns a credit or quota error, the AI Developer page offers **Retry using mock AI**. This starts a new workflow explicitly labeled `AI: MOCK`; it does not silently change the provider or require editing `.env`.

## Optional SAP ADT connectivity check (read-only)

Mock SAP remains the default. JDAP only contacts an SAP server when you explicitly configure the values below and request `GET http://localhost:4001/api/sap/adt/connection`. The request is a GET to SAP's ADT discovery resource; it checks reachability and authentication only. A successful response does **not** mean JDAP is reading source code or connected for development operations.

For an SAP HTTPS endpoint, add these values to `.env` (never share or commit this file):
```env
SAP_ADT_BASE_URL=https://your-sap-host:port
SAP_ADT_ALLOW_HTTP=false
SAP_ADT_CLIENT=100
SAP_ADT_USERNAME=your_read_only_user
SAP_ADT_PASSWORD=your_password
SAP_ADT_TIMEOUT_MS=8000
```

For this installation's SAP HTTP route, use the reachable port 8014 and explicitly allow HTTP:
```env
SAP_ADT_BASE_URL=http://103.89.45.155:8014
SAP_ADT_ALLOW_HTTP=true
SAP_ADT_CLIENT=200
```
If `SAP_ADT_USERNAME`, `SAP_ADT_PASSWORD`, or `SAP_ADT_CLIENT` are blank, JDAP reuses the corresponding `SAP_ODATA_*` value. Dedicated `SAP_ADT_*` values take precedence when supplied.

The SAP administrator must expose the ADT ICF service and grant the user only the ADT discovery/read permissions required by your release. The connection check issues a read-only `GET /sap/bc/adt/discovery`. HTTP sends Basic credentials without encryption; use it only on your approved protected network. HTTP must be explicitly enabled with `SAP_ADT_ALLOW_HTTP=true`; HTTPS certificate verification remains enabled and is never bypassed. Recreate the backend after editing `.env`:
```powershell
docker compose up -d --force-recreate backend
Invoke-RestMethod http://localhost:4001/api/sap/adt/connection
```

Possible states include `not-configured`, `reachable`, `missing-credentials`, `unauthorized`, `adt-not-found`, `timeout`, and `unreachable`. Passwords and authorization headers are not returned or logged. A reachable ADT discovery endpoint does not mean source retrieval is authorized. Source retrieval is a separate opt-in route; SAP writes are not implemented.

If SAP uses a private/self-signed TLS certificate, obtain the PEM-encoded issuing CA certificate or approved self-signed server certificate from your SAP Basis/security administrator (never a private key). Place it at `certs/sap-ca.pem`, then set `NODE_EXTRA_CA_CERTS=/run/certs/sap-ca.pem` in `.env`. The backend container mounts `./certs` read-only and Node adds that certificate to its trust list while normal TLS verification stays enabled. Recreate the backend after changing the certificate or `.env`. If the certificate is renewed, replace the PEM file with the new approved certificate. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### Optional ABAP program source read

For a controlled read-only source retrieval, set `SAP_ADT_ENABLE_SOURCE_READ=true` and configure a separate random `SAP_ADT_READ_API_TOKEN` in `.env`. Keep the token private. The **Testing Center** can retrieve one existing ABAP program using that token. The API requires `Authorization: Bearer <token>`, allows one simple program name per request, and limits the response to 1 MiB. The token is held only in the page state for the request; retrieved source is not added to workflow history. Use a read-only SAP account. The endpoint only performs an ADT GET; it does not modify SAP. The API token protects this route, but JDAP as a whole does not yet have user sign-in, so only expose the Docker ports on a trusted developer machine/network. For the HTTP route used in this setup, SAP credentials and source text are unencrypted in transit.

After recreating the backend, retrieve a program from PowerShell (replace the example program and token with your own):
```powershell
$headers = @{ Authorization = "Bearer <your-JDAP-token>" }
Invoke-RestMethod -Headers $headers "http://localhost:4001/api/sap/adt/programs/Z_MY_REPORT/source"
```

This fetch route is not part of workflows. Live retrieval still requires the configured HTTP/HTTPS endpoint and SAP-side ADT authorization; it has not been tested against your SAP system.

### Controlled SAP report creation

The **Testing Center** can create one new ABAP report from an **approved saved JDAP draft**. This is a real SAP write, so it is off by default and requires a separate create token plus an explicit per-request confirmation. The first version supports only Z reports in `$TMP` (local objects): it creates the repository object, locks it, writes the approved source and unlocks it. It deliberately does not activate or transport the report. Confirm the destination system and SAP user before enabling it. If a request fails after SAP has created the shell, JDAP reports `partial-create`; check SAP before retrying.

Enable only when you are ready to perform that SAP write:
```env
SAP_ADT_ENABLE_OBJECT_CREATE=true
SAP_ADT_CREATE_API_TOKEN=use-a-different-long-random-token
```
Keep `SAP_ADT_ENABLE_SOURCE_READ` and its token independent. Recreate the backend after editing `.env`:
```powershell
docker compose up -d --force-recreate backend
```
In **Testing Center**, select an approved draft, enter a new Z program name that exactly matches the source `REPORT`/`PROGRAM` statement, add a description, enter the create token, and type `CREATE IN SAP`. This creates an inactive object in `$TMP`. For the HTTP route, authentication and ABAP source are unencrypted in transit. Keep JDAP bound to a trusted developer machine/network. Do not enable this in production.

This initial creation flow is not a substitute for normal transport-based development: it does not support customer packages, transport requests, activation, ATC, DDIC validation, or rollback. Use SAP ADT/Eclipse for transportable development until those capabilities are implemented and validated for your SAP release.

## Optional ECC SAP Gateway OData check (read-only)

This independent business-API connection check does not use ADT. Configure a specific OData V2 service that your SAP Basis team confirms is active. The SAP administrator can register and activate supported services through transaction `/IWFND/MAINT_SERVICE`; which billing service exists depends on your ECC landscape and installed components. Do not assume an S/4HANA billing API name exists on ERP 6.0 EHP8. SAP documents service registration and ICF activation in its [Gateway service configuration guide](https://help.sap.com/docs/ABAP_PLATFORM_NEW/7259d88d2fab47bd808adcad3ca7ee9d/08b0a4f2c99f4051bbe170dc011cad42.html).

Add these values to `.env`, using the exact service root supplied by Basis (ending in `/sap/opu/odata/sap/<SERVICE_NAME>`):
```env
SAP_ODATA_SERVICE_URL=https://your-sap-host:port/sap/opu/odata/sap/YOUR_SERVICE_SRV
SAP_ODATA_ALLOW_HTTP=false
SAP_ODATA_CLIENT=200
SAP_ODATA_ENTITY_SET=DescMaterialSet
SAP_ODATA_USERNAME=your_read_only_user
SAP_ODATA_PASSWORD=your_password
SAP_ODATA_TIMEOUT_MS=8000
```

For your SAP HTTP service on port 8014, use the service root in `.env`, for example:
```env
SAP_ODATA_SERVICE_URL=http://103.89.45.155:8014/sap/opu/odata/sap/ZMATERIAL_DESC_SRV
SAP_ODATA_ALLOW_HTTP=true
SAP_ODATA_CLIENT=200
SAP_ODATA_ENTITY_SET=DescMaterialSet
```
HTTP Basic credentials and SAP business data are not encrypted in transit; use HTTP only on the network approved for this connection. Recreate the backend after changing `.env`. The **SAP Systems** page can **Discover service model** to list OData entity sets and property names/types from `$metadata`. Select a discovered entity set, then use **Check fields only** (discards values) or **Preview one live row** (shows the first row in the page without saving it). JDAP caps metadata at 1 MiB and sample responses at 256 KiB, retains only one row, and discards extras if SAP ignores `$top=1`.

To include one fresh SAP sample row in an AI Developer workflow, JDAP requires the metadata connection to be reachable and `AI_PROVIDER=openai`. Enable **Include one live SAP OData sample row in agent context** for that task and confirm the disclosure. JDAP makes a new OData GET, passes only the first row directly to the architecture and ABAP agents, and records field names/transport in the workflow audit without separately storing the row. OpenAI receives the sample values; JDAP instructs agents to treat them as untrusted data and not repeat actual values. The generated workflow draft is persisted in JDAP and should still be reviewed for accidental disclosure. No SAP development repository is accessed or written.

## Local development without Docker
The source also includes npm scripts for native development, but this ZIP's documented and recommended run path is Docker Compose.

## API
- `GET /api/health`
- `GET /api/agents`
- `GET /api/systems`
- `POST /api/workflows/execute` body: `{ "prompt": "...", "systemId": "mock-ecc" }`; returns a workflow ID immediately
- `POST /api/workflows/execute` may also include `{ "includeSapContext": true, "sapEntitySet": "DescMaterialSet" }` for a fresh live sample in an explicitly confirmed OpenAI workflow
- `GET /api/workflows/:id` returns live agent statuses while the workflow runs and the saved artifact when complete
- `GET /api/artifacts/:id`
- `GET /api/approvals` lists local draft-review records
- `POST /api/approvals` body: `{ "artifactId": "...", "requestNote": "..." }`; creates a pending local review
- `PATCH /api/approvals/:id` body: `{ "decision": "APPROVED" | "REJECTED", "reviewNote": "..." }`; records a local decision only
- `GET /api/approvals/:id/handoff` downloads a JSON developer handoff for an approved draft only and records the export in the audit log; it does not call SAP
- `GET /api/audit`
- `GET /api/sap/adt/connection` explicitly checks configured ADT discovery reachability; it does not retrieve source code
- `GET /api/sap/adt/programs/:name/source` reads one ABAP program when `SAP_ADT_ENABLE_SOURCE_READ=true` and a JDAP bearer token is configured
- `POST /api/sap/adt/programs/create` creates one approved report in `$TMP` as inactive when `SAP_ADT_ENABLE_OBJECT_CREATE=true`; requires a separate bearer token and `confirmation: "CREATE IN SAP"`
- `GET /api/sap/odata/connection` checks configured ECC Gateway OData V2 service metadata and reports HTTP/HTTPS transport
- `GET /api/sap/odata/metadata` discovers OData V2 entity-set names and property names/types; it reads metadata only
- `GET /api/sap/odata/read-check` explicitly requests `$top=1`, then reports the received count and field names only; SAP may return more if its service ignores the limit
- `GET /api/sap/odata/sample?entitySet=DescMaterialSet` explicitly reads a live sample and returns only the first row, bounded to a 256 KiB response; extra returned rows are discarded
- In a workflow request, `includeSapContext: true` reads the selected entity set; the first row is supplied to OpenAI agents and its field names/transport are recorded, but the row itself is not separately stored by JDAP (generated agent output may include SAP values)
- `POST /api/abap/syntax-check` body: `{ "source": "...", "release": "v750" }`; performs an offline grammar check without contacting SAP

## Safety boundaries
- Mock ECC/S/4HANA/BTP profiles remain the development targets; optional direct SAP OData routes are read-only. A live OData row enters an OpenAI workflow only when the user enables it and confirms the disclosure.
- When the SAP OData URL uses HTTP, Basic credentials and returned business data are not encrypted in transit. Set `SAP_ODATA_ALLOW_HTTP=true` only on a network approved for that use. JDAP does not silently downgrade HTTPS to HTTP.
- Generated code is untrusted draft content.
- SAP report creation is a separate, disabled-by-default opt-in. It requires an approved saved draft, a separate create token, and per-request confirmation; it creates in `$TMP` and does not activate or transport.
- Testing Center runs offline ABAP grammar checks only; it does not perform SAP compiler checks, DDIC validation, ATC, ABAP Unit, transport operations, or deployment.
- Production use requires identity integration, tenant isolation, secret management, threat modeling, data-retention controls, and live SAP integration testing.
