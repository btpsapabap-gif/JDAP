import { randomUUID } from "node:crypto";
import { AGENTS } from "../agents/registry.js";
import { runAgent } from "../agents/runner.js";
import { discoverMockSystem } from "../integrations/sap-mock.js";

const HANDOFFS = {
  abap: ["architect"],
  "cds-rap": ["architect", "abap"],
  fiori: ["architect", "cds-rap"],
  integration: ["architect"],
  debug: ["architect", "abap", "integration"],
  testing: ["architect", "abap", "cds-rap", "fiori", "integration"],
  review: ["abap", "cds-rap", "fiori", "integration"],
  security: ["abap", "cds-rap", "fiori", "integration"],
  compatibility: ["architect", "abap", "cds-rap", "fiori", "integration"],
  documentation: ["architect", "abap", "testing", "review", "security"],
  devops: ["architect", "testing", "review", "security", "documentation"]
};

export async function executeWorkflow({ prompt, systemId, model, sapContext, onAgent }) {
  if (!prompt?.trim()) throw new Error("A development prompt is required.");
  const aiProvider = model ? "openai" : "mock";
  const system = await discoverMockSystem(systemId || "mock-ecc");
  const context = {
    system,
    note: sapContext ? "Live OData read-only sample supplied; the SAP development repository was not accessed." : "Mock environment only; no live SAP repository was accessed.",
    ...(sapContext ? { sapODataSample: { entitySet: sapContext.entitySet, transport: sapContext.transport, fields: sapContext.fields, firstRow: sapContext.sample } } : {})
  };
  const sequence = ["architect","abap","cds-rap","fiori","integration","debug","testing","review","security","compatibility","documentation","devops"];
  const outputs = {};
  const activities = [];
  const mockStepDelayMs = Math.max(0, Number(process.env.MOCK_AGENT_STEP_DELAY_MS ?? 200));
  for (const agentId of sequence) {
    const started = Date.now();
    const event = { agentId, name: AGENTS.find(a => a.id === agentId).name, status: "RUNNING", durationMs: 0 };
    activities.push(event);
    if (onAgent) await onAgent(event);
    if (!model && mockStepDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, mockStepDelayMs));
    }
    const priorAgentWork = Object.fromEntries((HANDOFFS[agentId] || [])
      .filter(priorId => outputs[priorId])
      .map(priorId => [priorId, outputs[priorId].slice(0, 1600)]));
    const agentContext = { ...context, priorAgentWork };
    if (sapContext && !["architect", "abap"].includes(agentId)) delete agentContext.sapODataSample;
    const output = await runAgent(agentId, {
      prompt,
      system,
      context: agentContext
    }, model);
    outputs[agentId] = output;
    event.status = "COMPLETED";
    event.durationMs = Date.now() - started;
    if (onAgent) await onAgent(event);
  }
  const artifactId = randomUUID();
  const liveContextNote = sapContext
    ? `\n## Live SAP data context\n- OData entity set: ${sapContext.entitySet}\n- Transport: ${sapContext.transport}\n- First-row fields supplied to agents: ${sapContext.fields.join(", ")}\n- SAP returned ${sapContext.rowsReceived} row(s) for a $top=1 request; JDAP retained only the first row.\n- A live data row was included in agent context; review generated content for sensitive values before sharing.\n`
    : "";
  const artifact = {
    id: artifactId,
    title: "Generated SAP development draft",
    type: "text/markdown",
    content: `# JDAP Development Draft\n\n## Execution context\n- AI provider: ${aiProvider.toUpperCase()}\n- SAP target: ${system.name} (${system.release}) — MOCK ONLY\n- SAP development repository: not accessed; no SAP object writes occurred\n${liveContextNote}\n## Requirement\n${prompt}\n\n## Architecture\n${outputs.architect}\n\n## ABAP draft\n\`\`\`abap\n${outputs.abap}\n\`\`\`\n\n## CDS / RAP\n${outputs["cds-rap"]}\n\n## Fiori\n${outputs.fiori}\n\n## Integration\n${outputs.integration}\n\n## Debugging considerations\n${outputs.debug}\n\n## Testing\n${outputs.testing}\n\n## Code review\n${outputs.review}\n\n## Security\n${outputs.security}\n\n## Compatibility\n${outputs.compatibility}\n\n## Documentation\n${outputs.documentation}\n\n## DevOps\n${outputs.devops}\n\n---\n**Safety:** Draft only. No SAP repository write, activation, transport or deployment was performed.\n`
  };
  return { id: randomUUID(), status: "COMPLETED", aiProvider, sapConnectivity: sapContext ? "LIVE ODATA READ ONLY" : "MOCK ONLY", system, activities, outputs, artifact, createdAt: new Date().toISOString() };
}
