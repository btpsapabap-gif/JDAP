import { Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { checkSapAdtConnection, createInactiveAbapProgram, readAbapProgramSource } from "../../integrations/sap-adt/client.js";
import { writeAuditEvent } from "../../audit/service.js";

function validApiToken(req, envKey) {
  const expected = process.env[envKey] || "";
  const supplied = req.get("authorization") || "";
  const match = /^Bearer (.+)$/i.exec(supplied);
  if (!expected || !match) return false;
  const actualBytes = Buffer.from(match[1]);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function createSapAdtRouter(pool) {
  const router = Router();
  router.get("/connection", async (_req, res) => {
    try { res.json({ ...await checkSapAdtConnection(), sourceReadEnabled: process.env.SAP_ADT_ENABLE_SOURCE_READ === "true", objectCreateEnabled: process.env.SAP_ADT_ENABLE_OBJECT_CREATE === "true" }); }
    catch (error) { res.status(400).json({ configured: true, state: "invalid-configuration", message: error.message }); }
  });
  router.get("/programs/:name/source", async (req, res) => {
    if (process.env.SAP_ADT_ENABLE_SOURCE_READ !== "true") return res.status(404).json({ state: "disabled", message: "SAP source retrieval is disabled." });
    if (!validApiToken(req, "SAP_ADT_READ_API_TOKEN")) return res.status(401).json({ state: "unauthorized", message: "A valid JDAP bearer token is required." });
    try {
      const result = await readAbapProgramSource(req.params.name);
      const status = result.status || 200;
      res.status(status).json(result);
    } catch (error) { res.status(400).json({ state: "invalid-configuration", message: error.message }); }
  });
  router.post("/programs/create", async (req, res) => {
    if (process.env.SAP_ADT_ENABLE_OBJECT_CREATE !== "true") return res.status(404).json({ state: "disabled", message: "SAP object creation is disabled. No SAP request was sent." });
    if (!validApiToken(req, "SAP_ADT_CREATE_API_TOKEN")) return res.status(401).json({ state: "unauthorized", message: "A valid, separate JDAP create token is required." });
    const { approvalId, programName, description, confirmation } = req.body || {};
    if (confirmation !== "CREATE IN SAP") return res.status(400).json({ state: "confirmation-required", message: "Type CREATE IN SAP to confirm this one-time object creation." });
    if (typeof approvalId !== "string" || approvalId.length > 80) return res.status(400).json({ state: "approval-required", message: "Choose an approved saved JDAP draft." });
    try {
      const approved = await pool.query(`
        SELECT r.id AS approval_id, r.status, a.content, w.id AS workflow_id
        FROM approval_requests r
        JOIN artifacts a ON a.id=r.artifact_id
        LEFT JOIN workflows w ON w.id=a.workflow_id
        WHERE r.id=$1 AND r.status='APPROVED'
      `, [approvalId]);
      if (!approved.rowCount) return res.status(409).json({ state: "draft-not-approved", message: "Only a draft with an APPROVED review record can be sent to SAP." });
      const source = approved.rows[0].content.match(/## ABAP draft\s+```abap\s*([\s\S]*?)```/i)?.[1]?.trim();
      if (!source) return res.status(422).json({ state: "abap-source-missing", message: "The approved artifact has no extractable ABAP draft." });
      const result = await createInactiveAbapProgram({ approvalId, programName, description, source });
      if (result.ok || result.created) {
        await writeAuditEvent(pool, approved.rows[0].workflow_id || null, result.ok ? "SAP_ADT_PROGRAM_CREATED_INACTIVE" : "SAP_ADT_PROGRAM_CREATE_PARTIAL", {
          approvalId, programName: result.programName || String(programName || "").toUpperCase(), package: "$TMP",
          sourceSha256: createHash("sha256").update(source).digest("hex"), state: result.state, activated: false
        });
      }
      res.status(result.status || (result.ok ? 201 : 502)).json(result);
    } catch (error) { res.status(400).json({ state: "invalid-configuration", message: error.message }); }
  });
  return router;
}
