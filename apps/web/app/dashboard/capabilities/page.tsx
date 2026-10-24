import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {BIOINFORMATICS_PHASES,MERGED_MILESTONES,PARTIAL_MILESTONES,validateProgramPhases} from "@/lib/bioinformatics-program-v73";

export const dynamic="force-dynamic";
export default async function ScientificCapabilityProgress(){
  const db=await createClient();
  const {data,error}=await db.auth.getClaims();
  if(error||!data?.claims?.sub)redirect("/login");
  validateProgramPhases();
  return <main className="genithm-page">
    <header className="genithm-page-heading"><div>
      <div className="genithm-page-kicker">GENITHM / SCIENTIFIC DELIVERY</div>
      <h1>Bioinformatics development checklist</h1>
      <p>Implemented tools, unfinished scientific pipelines and the acceptance tests needed before they are called production ready.</p>
    </div><Link className="button" href="/dashboard/operations">Check live worker readiness</Link></header>
    <p className="genithm-note">The roadmap shows code/project milestones, not a live instrument-status feed. Service heartbeats, quotas and real compute readiness must be checked separately. A partially implemented phase is not complete even if individual modules pass tests.</p>
    <section className="genithm-card" aria-label="Merged capability milestones">
      <h2>Completed code milestones</h2>
      <ul>{MERGED_MILESTONES.map(x=><li key={x.version}><strong>✓ {x.version}</strong> — {x.what}</li>)}</ul>
      {PARTIAL_MILESTONES.length>0&&<><h3>New research components subject to release approval</h3>
      <ul>{PARTIAL_MILESTONES.map(x=><li key={x.version}>
        <strong>◻ {x.version}</strong> — {x.what} (<a href={x.reference}>release evidence</a>)
      </li>)}</ul></>}
    </section>
    <section aria-label="P0 through P10 scientific coverage stages" style={{marginTop:18}}>
      <h2>Full-platform acceptance checklist</h2>
      <p><strong>0 of 11 end-to-end scientific program phases are certified complete.</strong> The checkmarks above refer to narrower, merged code milestones.</p>
      <div className="genithm-card-grid">{BIOINFORMATICS_PHASES.map(phase=><article className="genithm-card" key={phase.id}>
        <p className="genithm-page-kicker">◻ {phase.id} / {phase.state.toUpperCase().replace('_',' ')}</p>
        <h3>{phase.title}</h3>
        {!!phase.implemented.length&&<><h4>Implemented components</h4><ul>{phase.implemented.map(x=><li key={x}>✓ {x}</li>)}</ul></>}
        <h4>Remaining acceptance work</h4>
        <ul>{phase.remaining.map(x=><li key={x}>◻ {x}</li>)}</ul>
        <p className="genithm-note"><strong>Completion criterion:</strong> {phase.completion_rule}</p>
      </article>)}</div>
    </section>
    <p className="genithm-note"><Link href="/dashboard/apps">Back to analyses</Link> · <Link href="/dashboard/rnaseq">RNA-seq workspace</Link> · <Link href="/dashboard/operations">Live execution status</Link></p>
  </main>;
}
