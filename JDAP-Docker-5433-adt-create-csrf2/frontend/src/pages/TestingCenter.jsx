import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Play, ShieldCheck, Code2 } from "lucide-react";

function extractAbap(content = "") {
  return content.match(/## ABAP draft\s+```abap\s*([\s\S]*?)```/i)?.[1]?.trim() || "";
}

export default function TestingCenter({ initialSource = "", objectCreateEnabled = false }) {
  const [source, setSource] = useState(initialSource);
  const [sourceOrigin, setSourceOrigin] = useState(initialSource ? "Latest workflow draft" : "");
  const [release, setRelease] = useState("v750");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [programName, setProgramName] = useState("");
  const [adtToken, setAdtToken] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [approvedDrafts, setApprovedDrafts] = useState([]);
  const [approvalId, setApprovalId] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createToken, setCreateToken] = useState("");
  const [createConfirmation, setCreateConfirmation] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createResult, setCreateResult] = useState(null);

  useEffect(() => {
    let active = true;
    if (initialSource) {
      setSource(initialSource); setSourceOrigin("Latest workflow draft"); setResult(null);
      return () => { active = false; };
    }
    fetch("/api/workflows").then(r => r.json()).then(async workflows => {
      const latest = workflows.find(item => item.artifact_id);
      if (!latest) return;
      const response = await fetch(`/api/artifacts/${latest.artifact_id}`);
      const artifact = await response.json();
      const code = extractAbap(artifact.content || "");
      if (active && code) { setSource(code); setSourceOrigin("Loaded from saved workflow history"); }
    }).catch(() => {});
    return () => { active = false; };
  }, [initialSource]);

  useEffect(() => {
    fetch("/api/approvals").then(r => r.json()).then(items => {
      if (Array.isArray(items)) setApprovedDrafts(items.filter(item => item.status === "APPROVED" && /## ABAP draft\s+```abap/i.test(item.artifact_content || "")));
    }).catch(() => {});
  }, []);

  async function checkSyntax() {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/abap/syntax-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, release })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Syntax check could not run.");
      setResult(data);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function retrieveFromSap() {
    setSourceBusy(true); setSourceError("");
    try {
      const response = await fetch(`/api/sap/adt/programs/${encodeURIComponent(programName.trim())}/source`, {
        headers: { Authorization: `Bearer ${adtToken}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.state || "Could not retrieve source from SAP ADT.");
      setSource(data.source || "");
      setSourceOrigin(`SAP ADT read · ${data.programName} · ${data.transport || "HTTP(S)"}`);
      setResult(null); setError("");
    } catch (e) { setSourceError(e.message); }
    finally { setSourceBusy(false); }
  }

  async function createInSap() {
    setCreateBusy(true); setCreateError(""); setCreateResult(null);
    try {
      const response = await fetch("/api/sap/adt/programs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${createToken}` },
        body: JSON.stringify({ approvalId, programName: createName.trim(), description: createDescription.trim(), confirmation: createConfirmation })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.state || "Could not create the SAP report.");
      setCreateResult(data);
    } catch (e) { setCreateError(e.message); }
    finally { setCreateBusy(false); }
  }

  return <div className="testing-page">
    <section className="panel adt-source-panel">
      <div className="panelhead"><div><span className="eyebrow">LIVE SAP READ</span><h2>Load an existing ABAP program</h2></div><Code2 size={20} className="testing-icon"/></div>
      <p className="testing-copy">Retrieve one existing program through the configured ADT HTTP route, then inspect or syntax-check it here. This uses GET only; it does not change SAP. Source retrieval must be enabled by the JDAP administrator. HTTP does not encrypt SAP credentials or source text in transit.</p>
      <div className="adt-source-toolbar">
        <label>ABAP program name<input value={programName} onChange={event=>setProgramName(event.target.value)} placeholder="Z_EXISTING_PROGRAM" maxLength={40} autoCapitalize="characters"/></label>
        <label>JDAP read token<input type="password" value={adtToken} onChange={event=>setAdtToken(event.target.value)} placeholder="Enter the token configured in .env" autoComplete="off"/></label>
        <button className="secondary" onClick={retrieveFromSap} disabled={sourceBusy || !programName.trim() || !adtToken.trim()}>{sourceBusy ? "Reading from SAP…" : "Read source from SAP"}</button>
      </div>
      {sourceError && <div className="error">{sourceError}</div>}
      <small className="live-context-muted">The token is used for this request and is not saved in JDAP. Retrieved source remains in this page’s browser state and is not added to workflow history.</small>
    </section>
    <section className="panel adt-source-panel">
      <div className="panelhead"><div><span className="eyebrow">CONTROLLED SAP DELIVERY</span><h2>Create an approved report in SAP</h2></div><ShieldCheck size={20} className="testing-icon"/></div>
      <p className="testing-copy">This sends an approved JDAP report to SAP ADT and saves it inactive in the local package $TMP. It does not activate or transport the report. {objectCreateEnabled ? "The administrator has enabled creation." : "Creation is currently disabled in backend settings."}</p>
      <div className="adt-source-toolbar">
        <label>Approved JDAP draft<select disabled={!objectCreateEnabled} value={approvalId} onChange={event=>setApprovalId(event.target.value)}><option value="">Choose an approved draft</option>{approvedDrafts.map(item=><option key={item.id} value={item.id}>{item.artifact_title} · {item.id.slice(0,8)}</option>)}</select></label>
        <label>New SAP program name<input disabled={!objectCreateEnabled} value={createName} onChange={event=>setCreateName(event.target.value.toUpperCase())} placeholder="Z_JDAP_REPORT" maxLength={40}/></label>
        <label>Program description<input disabled={!objectCreateEnabled} value={createDescription} onChange={event=>setCreateDescription(event.target.value)} placeholder="JDAP approved report" maxLength={60}/></label>
        <label>JDAP create token<input disabled={!objectCreateEnabled} type="password" value={createToken} onChange={event=>setCreateToken(event.target.value)} placeholder="Separate token configured by administrator" autoComplete="off"/></label>
        <label>Type CREATE IN SAP to confirm<input disabled={!objectCreateEnabled} value={createConfirmation} onChange={event=>setCreateConfirmation(event.target.value)} placeholder="CREATE IN SAP" autoComplete="off"/></label>
        <button className="primary" onClick={createInSap} disabled={!objectCreateEnabled || createBusy || !approvalId || !createName.trim() || !createDescription.trim() || !createToken.trim() || createConfirmation !== "CREATE IN SAP"}>{createBusy ? "Creating inactive report…" : "Create inactive report in SAP"}</button>
      </div>
      {createError && <div className="error">{createError}</div>}
      {createResult && <div className="syntax-result success"><div className="syntax-result-head"><CheckCircle2 size={16}/><b>{createResult.message}</b></div></div>}
      <small className="live-context-muted">The request is limited to an approved saved draft and a Z program in $TMP. If SAP reports a partial create, check the object in SAP before retrying. SAP activation, package assignment, and transport are not performed.</small>
    </section>
    <section className="panel testing-panel">
      <div className="panelhead"><div><span className="eyebrow">ABAP QUALITY GATE</span><h2>Syntax and release check</h2></div><ShieldCheck size={20} className="testing-icon"/></div>
      <p className="testing-copy">Run an offline ABAP grammar check against the selected SAP_BASIS release. This catches parser-level syntax issues before review.</p>
      <div className="testing-toolbar"><label htmlFor="abapRelease">Target release</label><select id="abapRelease" value={release} onChange={e => setRelease(e.target.value)}><option value="v750">SAP_BASIS 7.50 · ECC EHP8 / NetWeaver 7.5</option><option value="v740sp08">SAP_BASIS 7.40 SP08</option><option value="v740sp05">SAP_BASIS 7.40 SP05</option><option value="v740sp02">SAP_BASIS 7.40 SP02</option><option value="v702">SAP_BASIS 7.02</option><option value="v751">SAP_BASIS 7.51</option><option value="v752">SAP_BASIS 7.52</option><option value="v753">SAP_BASIS 7.53</option><option value="v754">SAP_BASIS 7.54</option><option value="v755">SAP_BASIS 7.55</option><option value="v756">SAP_BASIS 7.56</option><option value="v757">SAP_BASIS 7.57</option><option value="v758">SAP_BASIS 7.58</option></select><button className="primary" onClick={checkSyntax} disabled={busy || !source.trim()}><Play size={14}/>{busy ? "Checking…" : "Check ABAP syntax"}</button></div>
      <label className="testing-label" htmlFor="abapSource">ABAP source {sourceOrigin && <span>{sourceOrigin}</span>}</label>
      <textarea id="abapSource" className="syntax-editor" value={source} onChange={e => setSource(e.target.value)} spellCheck="false" placeholder="Paste or edit an ABAP report here…" />
      {error && <div className="error">{error}</div>}
      {result && <div className={`syntax-result ${result.state === "grammar-ok" ? "success" : "failure"}`}>
        <div className="syntax-result-head">{result.state === "grammar-ok" ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}<b>{result.message}</b><span>{result.lineCount} lines · {result.release.toUpperCase()}</span></div>
        {result.issues.length > 0 && <ul>{result.issues.map((issue, index) => <li key={`${issue.line}-${index}`}><code>Line {issue.line}:{issue.column}</code> {issue.message}</li>)}</ul>}
      </div>}
    </section>
    <section className="panel testing-boundary"><b>Validation boundary</b><p>This local check validates ABAP grammar only. It cannot verify SAP Dictionary fields and types, custom objects, authorization behavior, ATC checks, or runtime results. Use SAP’s own syntax check in the development system before activation.</p></section>
  </div>;
}
