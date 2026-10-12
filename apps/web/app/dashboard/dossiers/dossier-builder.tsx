"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { DOSSIER_MAX_REPORTS, DOSSIER_MIN_REPORTS } from "@/lib/research-dossier";
import { reportSourceTitle } from "@/lib/scientific-report";
import styles from "./dossiers.module.css";

type Project = { id: string; name: string };
type ReportSummary = {
  id: string;
  projectId: string;
  sourceType: string;
  subtype: string | null;
  seal: string;
  generatedAt: string;
};

export function DossierBuilder({ projects, reports }: {
  projects: Project[]; reports: ReportSummary[];
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [chosen, setChosen] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const perProject = useMemo(() =>
    reports.filter(item => item.projectId === projectId), [reports, projectId]);
  const displayed = useMemo(() =>
    perProject.filter(item => {
      if (sourceFilter !== "all" && item.sourceType !== sourceFilter) return false;
      if (!query.trim()) return true;
      const words = (item.id + " " + item.sourceType + " " +
        (item.subtype ?? "") + " " + item.seal).toLowerCase();
      return words.includes(query.toLowerCase().trim().slice(0, 100));
    }), [perProject, sourceFilter, query]);
  const selectedSet = useMemo(() => new Set(chosen), [chosen]);
  const valid = chosen.length >= DOSSIER_MIN_REPORTS && chosen.length <= DOSSIER_MAX_REPORTS;
  const buildUrl = (path: string) => {
    const params = new URLSearchParams({ project_id: projectId });
    chosen.slice().sort().forEach(id => params.append("report_id", id));
    return path + "?" + params.toString();
  };
  function choose(id: string, checked: boolean) {
    setChosen(previous => {
      if (checked) return previous.includes(id) || previous.length >= DOSSIER_MAX_REPORTS
        ? previous : [...previous, id];
      return previous.filter(item => item !== id);
    });
  }
  function selectProject(id: string) {
    setProjectId(id);
    setChosen([]);
    setQuery("");
    setSourceFilter("all");
  }
  const selectedReports = chosen.map(id => perProject.find(item => item.id === id)).filter(
    (r): r is ReportSummary => Boolean(r),
  );
  return (
    <div className={styles.builder}>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}>
          <div><div className={styles.eyebrow}>01 · Choose evidence</div><h2>Curate sealed scientific reports</h2></div>
          <span className={styles.counter}>{chosen.length}/{DOSSIER_MAX_REPORTS} selected</span>
        </div>
        <div className={styles.filters}>
          <label>Research project
            <select value={projectId} onChange={event => selectProject(event.target.value)}>
              {projects.length === 0 ? <option value="">No authorized projects</option> : null}
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>Evidence type
            <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}>
              <option value="all">All scientific reports</option>
              <option value="scientific_job">Scientific computation</option>
              <option value="blast_job">BLAST</option>
              <option value="sequence_retrieval">NCBI retrieval</option>
              <option value="protein_annotation_job">Protein annotation</option>
            </select>
          </label>
          <label>Find report
            <input type="search" maxLength={100} value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Type, report UUID or SHA-256…" />
          </label>
        </div>
        <p className={styles.hint}>Choose 2–8 reports from the same project. This list contains at most 200 of your most recently generated owner-accessible reports; selections remain local until you open a dossier.</p>
        <div className={styles.reportList}>
          {displayed.map(report => (
            <label className={styles.report} key={report.id}>
              <input type="checkbox" checked={selectedSet.has(report.id)}
                disabled={!selectedSet.has(report.id) && chosen.length >= DOSSIER_MAX_REPORTS}
                onChange={event => choose(report.id, event.target.checked)} />
              <span className={styles.reportMain}>
                <strong>{reportSourceTitle(report.sourceType, report.subtype)}</strong>
                <small>{new Date(report.generatedAt).toLocaleString()} · {report.id}</small>
                <code>SHA-256 {report.seal}</code>
              </span>
              <span className={styles.sealed}>Sealed report</span>
            </label>
          ))}
          {!displayed.length ? <div className={styles.empty}>
            <strong>No reports in this selection</strong>
            <p>Generate sealed scientific reports from completed analyses, or choose another project/filter.</p>
            <Link className="button" href="/dashboard/reports">Open scientific reports</Link>
          </div> : null}
        </div>
      </section>
      <aside className={styles.panel}>
        <div className={styles.eyebrow}>02 · Assemble dossier</div>
        <h2>Research evidence package</h2>
        <p className={styles.hint}>Every included report is rechecked through the existing owner-scoped integrity-verification RPC. Mismatched, missing, oversized or cross-project records are rejected before any evidence is served.</p>
        <div className={styles.selectedList}>
          {selectedReports.map((report, index) => (
            <div className={styles.selectedItem} key={report.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{reportSourceTitle(report.sourceType, report.subtype)}</strong>
              <button type="button" aria-label={"Remove report " + report.id}
                onClick={() => choose(report.id, false)}>×</button>
            </div>
          ))}
          {!selectedReports.length ? <div className={styles.emptySmall}>
            Selected sources appear here. The dossier is never generated from unverified browser-supplied biological values.
          </div> : null}
        </div>
        {valid ? (
          <div className={styles.exportActions}>
            <Link className="button primary" href={buildUrl("/dashboard/dossiers/view")}>Compare & review dossier</Link>
            <a className="button" href={buildUrl("/dashboard/dossiers/export/json")}>Export verified JSON</a>
            <a className="button" href={buildUrl("/dashboard/dossiers/export/markdown")}>Export Markdown</a>
          </div>
        ) : (
          <p className={styles.hint}>Select at least two reports to enable verified dossier preview and export.</p>
        )}
        <div className={styles.policySmall}>
          <strong>No invented conclusions.</strong> Blank comparison cells mean the scientific metric was not recorded. This is a reproducibility package, not a new AI-generated scientific interpretation.
        </div>
      </aside>
    </div>
  );
}
