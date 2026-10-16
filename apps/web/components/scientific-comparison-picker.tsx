"use client";

import Link from "next/link";
import { useState } from "react";

import styles from "@/app/dashboard/results/results.module.css";
import type { ComparableJobType } from "@/lib/verified-scientific-comparison";

export type ComparableChoice = {
  id: string;
  jobType: ComparableJobType;
  projectName: string;
  createdAt: string;
};

const typeLabel: Record<ComparableJobType, string> = {
  protein_properties: "Protein properties",
  pairwise_alignment: "Pairwise alignment",
};

export function ScientificComparisonPicker({ choices }: { choices: ComparableChoice[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [candidate, setCandidate] = useState("");

  const picked = selected.map(id => choices.find(choice => choice.id === id)).filter(
    (choice): choice is ComparableChoice => Boolean(choice));
  const allowedType = picked[0]?.jobType ?? null;
  const available = choices.filter(choice => !selected.includes(choice.id) &&
    (allowedType === null || choice.jobType === allowedType));
  const next = available.some(choice => choice.id === candidate) ? candidate : (available[0]?.id ?? "");

  function addSelected() {
    if (!next || selected.length >= 4) return;
    setSelected(current => [...current, next]);
    setCandidate("");
  }

  return (
    <section className={styles.comparePicker} aria-label="Select completed scientific analyses to compare">
      <div className={styles.compareHeading}>
        <div>
          <span className={styles.compareKicker}>NEW · SCIENTIFIC COMPARISON</span>
          <h2>Compare verified research runs</h2>
          <p>Select 2–4 completed protein analyses or pairwise alignments. Genithm checks each stored artifact before displaying comparison measurements.</p>
        </div>
        <span className={styles.compareCount}>{selected.length} / 4 selected</span>
      </div>
      {choices.length < 2 ? (
        <p className={styles.compareEmpty}>Complete at least two supported scientific jobs to use the comparison workbench. No sample or fabricated data is shown.</p>
      ) : (
        <div className={styles.compareControls}>
          <label htmlFor="compare-select">Completed analysis
            <select id="compare-select" value={next} onChange={event => setCandidate(event.target.value)}
              disabled={!available.length || selected.length >= 4}>
              {available.length ? available.map(choice => (
                <option value={choice.id} key={choice.id}>
                  {typeLabel[choice.jobType]} · {choice.projectName} · {choice.id.slice(0, 8)}
                </option>
              )) : <option value="">No more compatible results</option>}
            </select>
          </label>
          <button type="button" onClick={addSelected}
            disabled={!next || selected.length >= 4}>＋ Add run</button>
          {selected.length >= 2 ? (
            <Link className={styles.compareLaunch}
              href={"/dashboard/results/compare?ids=" + encodeURIComponent(selected.join(","))}>
              Compare {selected.length} verified runs →
            </Link>
          ) : <span className={styles.compareHint}>Choose at least two runs of the same type</span>}
        </div>
      )}
      {picked.length ? (
        <div className={styles.compareChips} aria-live="polite">
          {picked.map((choice, index) => (
            <span className={styles.compareChip} key={choice.id}>
              Run {index + 1}: {typeLabel[choice.jobType]} {choice.id.slice(0, 8)}
              <button type="button" onClick={() => setSelected(old => old.filter(id => id !== choice.id))}
                aria-label={"Remove run " + (index + 1)}>×</button>
            </span>
          ))}
          <button className={styles.compareClear} type="button"
            onClick={() => { setSelected([]); setCandidate(""); }}>Clear all</button>
        </div>
      ) : null}
    </section>
  );
}
