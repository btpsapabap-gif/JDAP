import React from "react";
import { CheckCircle2, Download, FileCode2, Server } from "lucide-react";
import AgentList from "../agents/AgentList.jsx";
import StatsGrid from "../dashboard/StatsGrid.jsx";
import TaskComposer from "../chat/TaskComposer.jsx";

export default function AiDeveloper({ agents, systems, systemId, setSystemId, prompt, setPrompt, busy, run, error, canRetryMock, result, aiProvider, sapState, sapTransport, sapEntitySet, includeSapContext, setIncludeSapContext, onViewAgents, onDownload }) {
  return <>
    <StatsGrid agentCount={agents.length} systemCount={systems.length}/>
    <div className="workgrid">
      <TaskComposer systems={systems} systemId={systemId} setSystemId={setSystemId} prompt={prompt} setPrompt={setPrompt} busy={busy} run={run} error={error} canRetryMock={canRetryMock} aiProvider={aiProvider} sapState={sapState} sapTransport={sapTransport} sapEntitySet={sapEntitySet} includeSapContext={includeSapContext} setIncludeSapContext={setIncludeSapContext}/>
      <AgentList agents={agents} onViewAll={onViewAgents}/>
    </div>
    {result&&<div className="panel results">
      <div className="panelhead"><div><span className="eyebrow">WORKFLOW {result.status} · {result.activities.filter(a=>a.status==="COMPLETED").length}/12 AGENTS</span><h2>{result.status==="RUNNING"?"Agent progress":"Development result"}</h2></div>{result.artifact&&<button className="secondary" onClick={onDownload}><Download size={15}/> Download draft</button>}</div>
      <div className="resultmeta"><span><CheckCircle2 size={15}/> Workflow {result.id.slice(0,8)}</span><span><Server size={15}/> {result.system?.name||"Mock SAP target"}</span><span>AI: {(result.aiProvider||aiProvider||"mock").toUpperCase()}</span><span className="mockwarning">{result.sapConnectivity === "LIVE ODATA READ ONLY" ? "LIVE ODATA CONTEXT · READ ONLY" : "SAP MOCK — NO SAP CONNECTION"}</span></div>
      {result.status==="RUNNING"&&<div className="progressnote"><span className="spinner"/> {result.activities.find(a=>a.status==="RUNNING")?.name||"Preparing agents"} is working. {result.aiProvider==="mock"?"Mock workflow is simulating specialist steps.":"Progress updates automatically."}</div>}
      <div className="activitygrid">{result.activities.map(a=><div className="activity" key={a.agentId}>{a.status==="RUNNING"?<span className="spinner"/>:a.status==="FAILED"?<span className="agentfailed">!</span>:<CheckCircle2 size={15}/>}<div><b>{a.name}</b><small>{a.status==="RUNNING"?"Working…":a.status==="FAILED"?"Failed":`${a.durationMs} ms · completed`}</small></div></div>)}</div>
      {result.artifact&&<div className="artifact"><div className="artifacthead"><FileCode2 size={17}/> Generated development draft <span>MARKDOWN</span></div><pre>{result.artifact.content}</pre></div>}
    </div>}
  </>;
}
