"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DashboardPrimaryNav } from "./dashboard-primary-nav";
import { GenithmBrand } from "./genithm-brand";
import { GenithmIcon } from "./genithm-icon";

const destinations = [
  {label:"AI Chat",description:"Ask a biological question or plan an analysis",href:"/dashboard/ai"},
  {label:"Projects",description:"Your research projects",href:"/dashboard/projects"},
  {label:"Data",description:"Upload FASTA and browse recorded files",href:"/dashboard/data"},
  {label:"Pipelines",description:"Supported automated scientific workflows",href:"/dashboard/pipelines"},
  {label:"Results",description:"Recorded analyses and verified comparisons",href:"/dashboard/results"},
  {label:"Tools",description:"Browse available analysis tools",href:"/dashboard/apps"},
  {label:"FASTQ QC",description:"Local single-end and paired-end read quality",href:"/dashboard/fastq-qc"},
  {label:"Variant QC",description:"Local VCF quality summaries",href:"/dashboard/variant-qc"},
  {label:"Notebook",description:"Your private research notes",href:"/dashboard/notebook"},
  {label:"Reports",description:"Evidence-linked scientific reports",href:"/dashboard/reports"},
  {label:"Saved comparisons",description:"Reopen saved scientific studies",href:"/dashboard/results/studies"},
  {label:"Advanced tools",description:"FASTA, BLAST, alignments and protein analysis",href:"/dashboard/tools"},
];

export function GenithmWorkspaceFrame({children,email,isPlatformAdmin}:{children:ReactNode;email:string;isPlatformAdmin:boolean}) {
  const pathname = usePathname();
  // Conversation pages already have a real, searchable recent-chat sidebar.
  const chatPage = /^\/dashboard\/ai(?:\/[a-f0-9-]{36})?$/i.test(pathname);
  const searchDialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query,setQuery] = useState("");
  const [mobileOpen,setMobileOpen] = useState(false);
  function openSearch() { setQuery(""); searchDialog.current?.showModal(); searchInput.current?.focus(); }
  useEffect(() => {
    const listener = (event:KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchDialog.current?.showModal(); searchInput.current?.focus(); } };
    window.addEventListener("keydown",listener);
    return () => window.removeEventListener("keydown",listener);
  },[]);
  useEffect(() => { setMobileOpen(false); searchDialog.current?.close(); },[pathname]);
  const matches = destinations.filter(item => (item.label+" "+item.description).toLowerCase().includes(query.toLowerCase().trim()));
  return <div className="genithm-workspace" data-chat-layout={chatPage ? "true" : "false"}>
    <a className="genithm-skip" href="#genithm-content">Skip to workspace</a>
    <header className="genithm-topbar">
      <GenithmBrand />
      <button type="button" className="genithm-search-trigger" onClick={openSearch}><GenithmIcon name="search" /><span>Find a page or scientific tool...</span><kbd>Ctrl K</kbd></button>
      <details className="genithm-account">
        <summary><span className="genithm-user-avatar" aria-hidden="true">{email.slice(0,1).toUpperCase()}</span><span><strong>Your workspace</strong><small>{email}</small></span><span aria-hidden="true">⌄</span></summary>
        <div className="genithm-account-menu">
          <Link href="/dashboard/notebook">Research notebook</Link><Link href="/dashboard/ai/research">Research history</Link><Link href="/dashboard/billing">Plan and usage</Link>
          {isPlatformAdmin ? <><Link href="/dashboard/admin/billing">Billing administration</Link><Link href="/dashboard/admin/billing/payments">Payment administration</Link><Link href="/dashboard/admin/billing/payments/setup">Payment setup</Link></> : null}
          <form action="/auth/signout" method="post"><button type="submit">Sign out</button></form>
        </div>
      </details>
    </header>
    <div className="genithm-frame-grid">
      {!chatPage ? <aside className="genithm-frame-sidebar">
        <Link className="genithm-new-chat" href="/dashboard/ai"><GenithmIcon name="plus" />New chat</Link>
        <button type="button" className="genithm-mobile-menu" aria-expanded={mobileOpen} aria-controls="genithm-page-navigation" onClick={()=>setMobileOpen(!mobileOpen)}><GenithmIcon name="menu" />Workspace menu</button>
        <div id="genithm-page-navigation" data-mobile-open={mobileOpen}><DashboardPrimaryNav isPlatformAdmin={isPlatformAdmin}/></div>
      </aside> : null}
      <div id="genithm-content" className="genithm-frame-content" tabIndex={-1}>{children}</div>
    </div>
    <dialog ref={searchDialog} className="genithm-search-dialog" aria-labelledby="genithm-search-heading">
      <div className="genithm-search-dialog-heading"><h2 id="genithm-search-heading">Go to a page or tool</h2><button type="button" onClick={()=>searchDialog.current?.close()} aria-label="Close search">×</button></div>
      <label htmlFor="genithm-search-input" className="genithm-sr-only">Search available pages and tools</label>
      <input ref={searchInput} id="genithm-search-input" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Try FASTQ, projects, or notebook"/>
      <div className="genithm-search-results">{matches.map(item=><Link key={item.href} href={item.href} onClick={()=>searchDialog.current?.close()}><strong>{item.label}</strong><small>{item.description}</small></Link>)}{!matches.length?<p role="status">No matching tools or pages.</p>:null}</div>
      <p className="genithm-search-help">Searches navigation, not the contents of private research files. Press Escape to close.</p>
    </dialog>
  </div>;
}
