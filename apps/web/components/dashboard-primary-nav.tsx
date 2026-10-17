"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GenithmIcon } from "./genithm-icon";

// Only six everyday destinations. Specialized labs remain in Tools / More.
const primaryLinks = [
  {href:"/dashboard/ai",label:"AI Chat",icon:"chat",exact:false},
  {href:"/dashboard/projects",label:"Projects",icon:"projects",exact:false},
  {href:"/dashboard/data",label:"Data",icon:"data",exact:false},
  {href:"/dashboard/pipelines",label:"Pipelines",icon:"pipelines",exact:false},
  {href:"/dashboard/results",label:"Results",icon:"results",exact:false},
  {href:"/dashboard/apps",label:"Tools",icon:"tools",exact:false},
] as const;

const moreLinks = [
  {href:"/dashboard/notebook",label:"Research notebook",exact:false},
  {href:"/dashboard/ai/research",label:"Research history",exact:false},
  {href:"/dashboard/reports",label:"Reports",exact:false},
  {href:"/dashboard/results/studies",label:"Saved comparisons",exact:false},
  {href:"/dashboard/tools",label:"Advanced scientific tools",exact:false},
  {href:"/dashboard/variant-qc",label:"Variant QC",exact:false},
  {href:"/dashboard/fastq-qc",label:"FASTQ QC",exact:false},
  {href:"/dashboard/workflows",label:"Scientific workflows",exact:false},
  {href:"/dashboard/pipeline-studies",label:"Pipeline studies",exact:false},
  {href:"/dashboard/dossiers",label:"Evidence dossiers",exact:false},
  {href:"/dashboard/operations",label:"Execution status",exact:false},
  {href:"/dashboard/research-journey",label:"Research journey",exact:false},
  {href:"/dashboard/billing",label:"Plan and usage",exact:false},
  {href:"/dashboard/billing/payments",label:"Payments",exact:false},
] as const;

export function DashboardPrimaryNav({isPlatformAdmin = false}:{isPlatformAdmin?:boolean}) {
  const pathname = usePathname();
  const isTool = ["/dashboard/tools", "/dashboard/fastq-qc", "/dashboard/variant-qc"].some(p => pathname === p || pathname.startsWith(p + "/"));
  const current = primaryLinks.filter(link => pathname === link.href || pathname.startsWith(link.href + "/"))
    .sort((a,b) => b.href.length - a.href.length)[0]?.href;
  return <nav className="genithm-primary-nav" aria-label="Workspace navigation">
    <div className="genithm-primary-links">
      {primaryLinks.map(link => {
        const active = (current === link.href && !(link.href === "/dashboard/ai" && pathname.startsWith("/dashboard/ai/research"))) || (link.href === "/dashboard/apps" && isTool);
        return <Link key={link.href} href={link.href} className={active ? "genithm-nav-link is-active" : "genithm-nav-link"} aria-current={active ? "page" : undefined}>
          <GenithmIcon name={link.icon} /><span>{link.label}</span>
        </Link>;
      })}
    </div>
    <details className="genithm-more-nav">
      <summary>More workspace options</summary>
      <div>{moreLinks.map(link => <Link href={link.href} key={link.href} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>)}
        {isPlatformAdmin ? <Link href="/dashboard/admin/billing">Administration</Link> : null}
      </div>
    </details>
  </nav>;
}
