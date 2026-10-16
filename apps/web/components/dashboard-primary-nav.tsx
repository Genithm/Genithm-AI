"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const primaryLinks = [
  {href:"/dashboard/ai",label:"BioAI chat",exact:false},
  {href:"/dashboard/tools",label:"Scientific tools",exact:false},
  {href:"/dashboard/variant-qc",label:"Variant QC",exact:false},
  {href:"/dashboard/results",label:"Results",exact:false},
  {href:"/dashboard/results/studies",label:"Saved studies",exact:false},
  {href:"/dashboard/notebook",label:"Notebook",exact:false},
  {href:"/dashboard/ai/research",label:"Research history",exact:false},
  {href:"/dashboard/reports",label:"Reports",exact:false},
] as const;

const advancedLinks = [
  {href:"/dashboard/operations",label:"Operations"},
  {href:"/dashboard/research-journey",label:"Research journey"},
  {href:"/dashboard/pipelines",label:"Pipelines"},
  {href:"/dashboard/pipeline-studies",label:"Pipeline studies"},
  {href:"/dashboard/dossiers",label:"Research dossiers"},
  {href:"/dashboard/billing",label:"Plan & usage"},
  {href:"/dashboard/billing/payments",label:"Payments"},
] as const;

function isActive(pathname:string,href:string):boolean {
  return pathname===href || pathname.startsWith(href+"/");
}

export function DashboardPrimaryNav({isPlatformAdmin}:{isPlatformAdmin:boolean}) {
  const pathname=usePathname();
  return (
    <nav className="dashboard-nav bioai-top-nav" aria-label="Workspace navigation">
      {primaryLinks.map((link)=> {
        // The research history tab must win over the broad /dashboard/ai prefix.
        const active=link.href==="/dashboard/ai"
          ? isActive(pathname,link.href) && !isActive(pathname,"/dashboard/ai/research")
          : isActive(pathname,link.href);
        return <Link key={link.href} className={active?"dashboard-nav-link is-active":"dashboard-nav-link"}
          href={link.href} aria-current={active?"page":undefined}>{link.label}</Link>;
      })}
      <details className="bioai-more">
        <summary>More <span aria-hidden="true">⌄</span></summary>
        <div className="bioai-more-menu">
          {advancedLinks.map((link)=><Link href={link.href} key={link.href}
            aria-current={isActive(pathname,link.href)?"page":undefined}>{link.label}</Link>)}
          {isPlatformAdmin ? <Link href="/dashboard/admin">Platform administration</Link> : null}
        </div>
      </details>
    </nav>
  );
}
