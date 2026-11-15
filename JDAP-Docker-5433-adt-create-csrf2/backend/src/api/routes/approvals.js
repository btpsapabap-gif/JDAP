import { Router } from "express";
import { writeAuditEvent } from "../../audit/service.js";

export function createApprovalRouter(pool) {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT r.id, r.artifact_id, r.status, r.request_note, r.review_note,
               r.requested_by, r.reviewed_by, r.created_at, r.reviewed_at,
               a.title AS artifact_title, a.artifact_type, a.content AS artifact_content,
               w.id AS workflow_id, w.prompt AS workflow_prompt
        FROM approval_requests r
        JOIN artifacts a ON a.id = r.artifact_id
        LEFT JOIN workflows w ON w.id = a.workflow_id
        ORDER BY CASE WHEN r.status='PENDING' THEN 0 ELSE 1 END, r.created_at DESC
        LIMIT 100
      `);
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.post("/", async (req, res) => {
    const { artifactId, requestNote = "" } = req.body || {};
    if (typeof artifactId !== "string") return res.status(400).json({ error: "A saved artifact ID is required." });
    if (typeof requestNote !== "string" || requestNote.length > 2000) return res.status(400).json({ error: "Review note must be text under 2,000 characters." });
    try {
      const artifact = await pool.query("SELECT id, workflow_id FROM artifacts WHERE id=$1", [artifactId]);
      if (!artifact.rowCount) return res.status(404).json({ error: "Saved draft not found." });
      const pending = await pool.query("SELECT id FROM approval_requests WHERE artifact_id=$1 AND status='PENDING' ORDER BY created_at DESC LIMIT 1", [artifactId]);
      if (pending.rowCount) return res.json({ id: pending.rows[0].id, status: "PENDING", existing: true });
      const created = await pool.query(
        "INSERT INTO approval_requests(artifact_id,request_note) VALUES($1,$2) RETURNING id,status,created_at",
        [artifactId, requestNote.trim()]
      );
      await writeAuditEvent(pool, artifact.rows[0].workflow_id, "APPROVAL_REQUESTED", { approvalId: created.rows[0].id, artifactId });
      res.status(201).json(created.rows[0]);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.patch("/:id", async (req, res) => {
    const { decision, reviewNote = "" } = req.body || {};
    if (!["APPROVED", "REJECTED"].includes(decision)) return res.status(400).json({ error: "Decision must be APPROVED or REJECTED." });
    if (typeof reviewNote !== "string" || reviewNote.length > 2000) return res.status(400).json({ error: "Review note must be text under 2,000 characters." });
    try {
      const updated = await pool.query(`
        UPDATE approval_requests SET status=$1, review_note=$2, reviewed_by='Local reviewer', reviewed_at=now()
        WHERE id=$3 AND status='PENDING'
        RETURNING id, artifact_id, status, review_note, reviewed_by, reviewed_at
      `, [decision, reviewNote.trim(), req.params.id]);
      if (!updated.rowCount) return res.status(409).json({ error: "This request is missing or has already been reviewed." });
      const workflow = await pool.query("SELECT workflow_id FROM artifacts WHERE id=$1", [updated.rows[0].artifact_id]);
      await writeAuditEvent(pool, workflow.rows[0]?.workflow_id || null, `APPROVAL_${decision}`, { approvalId: updated.rows[0].id, artifactId: updated.rows[0].artifact_id, reviewNote: reviewNote.trim() });
      res.json(updated.rows[0]);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  router.get("/:id/handoff", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT r.id AS approval_id, r.status, r.request_note, r.review_note,
               r.requested_by, r.reviewed_by, r.created_at AS requested_at, r.reviewed_at,
               a.id AS artifact_id, a.title AS artifact_title, a.artifact_type,
               a.content AS artifact_content, a.created_at AS artifact_created_at,
               w.id AS workflow_id, w.prompt AS workflow_prompt, w.system_id
        FROM approval_requests r
        JOIN artifacts a ON a.id = r.artifact_id
        LEFT JOIN workflows w ON w.id = a.workflow_id
        WHERE r.id=$1
      `, [req.params.id]);
      if (!result.rowCount) return res.status(404).json({ error: "Approval record not found." });
      const row = result.rows[0];
      if (row.status !== "APPROVED") return res.status(409).json({ error: "Only approved drafts can be exported for handoff." });
      const source = row.artifact_content.match(/## ABAP draft\s+```abap\s*([\s\S]*?)```/i)?.[1]?.trim() || null;
      const handoff = {
        handoffType: "JDAP_APPROVED_DRAFT",
        generatedAt: new Date().toISOString(),
        sapDeployment: "NOT_PERFORMED",
        manualSapActionRequired: true,
        approval: {
          id: row.approval_id, status: row.status, requestedBy: row.requested_by,
          requestedAt: row.requested_at, requestNote: row.request_note,
          reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, reviewNote: row.review_note
        },
        workflow: { id: row.workflow_id, systemProfile: row.system_id, prompt: row.workflow_prompt },
        artifact: {
          id: row.artifact_id, title: row.artifact_title, type: row.artifact_type,
          createdAt: row.artifact_created_at, markdown: row.artifact_content, abapSource: source
        },
        limitations: [
          "This package is a developer handoff, not a SAP transport or repository object.",
          "JDAP did not create, activate, transport, or deploy anything in SAP.",
          "Run applicable SAP-side syntax, DDIC, ATC, authorization, and quality checks before use."
        ]
      };
      await writeAuditEvent(pool, row.workflow_id, "APPROVAL_HANDOFF_EXPORTED", { approvalId: row.approval_id, artifactId: row.artifact_id });
      res.setHeader("Content-Disposition", `attachment; filename="jdap-approved-handoff-${row.artifact_id.slice(0, 8)}.json"`);
      res.json(handoff);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  return router;
}
