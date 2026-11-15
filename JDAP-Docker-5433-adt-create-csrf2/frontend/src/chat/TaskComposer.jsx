import React from "react";
import { Circle, Play } from "lucide-react";

export default function TaskComposer({ systems, systemId, setSystemId, prompt, setPrompt, busy, run, error, canRetryMock, aiProvider, sapState, sapTransport, sapEntitySet, includeSapContext, setIncludeSapContext }) {
  function startWorkflow() {
    const transportNotice = sapTransport === "HTTP" ? "HTTP does not encrypt credentials or data in transit." : "The configured HTTPS connection uses certificate validation.";
    if (includeSapContext && !window.confirm(`JDAP will make a live read-only ${sapTransport || "HTTP"} request to SAP, retain only the first row, and send its field values to the architecture and ABAP agents through OpenAI. ${transportNotice} The generated workflow draft is saved in JDAP and may include values. Continue?`)) return;
    run(undefined, includeSapContext, sapEntitySet);
  }
  return <div className="panel promptpanel">
    <div className="panelhead"><div><span className="eyebrow">NEW DEVELOPMENT TASK</span><h2>What are we building today?</h2></div><span className="spark">✦ AI</span></div>
    <label>Target SAP environment</label>
    <select value={systemId} onChange={e=>setSystemId(e.target.value)}>{systems.map(s=><option value={s.id} key={s.id}>{s.name} · {s.release}</option>)}</select>
    <label>Developer instruction</label>
    <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows="7" placeholder="Describe your SAP development requirement..."/>
    {sapState === "reachable" && <label className="live-context-toggle"><input type="checkbox" checked={includeSapContext} onChange={e=>setIncludeSapContext(e.target.checked)} disabled={(aiProvider||"mock").toLowerCase()!=="openai"}/> Include one live SAP OData sample row in agent context</label>}
    {includeSapContext && <p className="live-context-warning">Uses {sapEntitySet || "the configured entity set"} over {sapTransport || "the SAP OData connection"}. Only the first row is passed directly to the architecture and ABAP agents even if SAP ignores <code>$top=1</code>. The sample is sent to OpenAI and generated output is saved in JDAP. Do not enable for sensitive data unless approved.</p>}
    {sapState === "reachable" && (aiProvider||"mock").toLowerCase()!=="openai" && <small className="live-context-muted">Live context in agent workflows requires AI: OPENAI. You can preview SAP data on the SAP Systems page while AI is in mock mode.</small>}
    <div className="promptfoot"><span><Circle size={8}/> Agents will collaborate in a controlled workflow</span><button className="primary" onClick={startWorkflow} disabled={busy||!prompt.trim()}>{busy?<><span className="spinner"/> Running agents</>:<><Play size={15} fill="currentColor"/> Run agent workflow</>}</button></div>
    {error&&<div className="error">{error}{canRetryMock&&<button className="secondary retry-mock" onClick={()=>run("mock")} disabled={busy}>Retry using mock AI</button>}</div>}
    <div className="examples"><span>TRY:</span>{["Analyze an EA602 IDoc error","Design a CDS view for billing","Review an ABAP report for performance"].map(x=><button onClick={()=>setPrompt(x)} key={x}>{x}</button>)}</div>
  </div>;
}
