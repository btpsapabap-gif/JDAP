import React from "react";

export default function PageHeading({ page, database, sapState }) {
  const isSap = page === "SAP Systems";
  const label = isSap ? `ODATA ${sapState || "CHECKING"}` : database === "connected" ? "API · DATABASE OPERATIONAL" : "CHECKING SERVICES";
  const stateClass = isSap && sapState !== "reachable" ? "live warn" : "live";
  return <div className="heading"><div><div className="eyebrow">AI-POWERED SAP ENGINEERING</div><h1>{page==="AI Developer"?"Developer command center":page}</h1><p>Coordinate specialist agents to design, generate and validate SAP development drafts.</p></div><div className="heading-actions"><span className={stateClass}><i/> {label}</span></div></div>;
}
