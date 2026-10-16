import type { ExplorerResult } from "./scientific-result-explorer";

export type VerifiedExplorerSnapshot = {
  verification: string;
  sha256: string;
  jobType: string;
  view: ExplorerResult;
};

function safeCell(value: string | number | null): string {
  const raw = value === null ? "" : String(value);
  const singleLine = raw.replaceAll(/[\t\r\n\u0000-\u001f]/g, " ");
  // Prevent spreadsheet formula execution in any exported metadata or text.
  return /^[=+@]|^-(?!\d+(?:\.\d+)?(?:e[+-]?\d+)?$)/i.test(singleLine)
    ? "'" + singleLine : singleLine;
}

export function verifiedExplorerTsv(snapshot: VerifiedExplorerSnapshot): string {
  if (snapshot.verification !== "sha256-verified" ||
      !/^[a-f0-9]{64}$/.test(snapshot.sha256)) {
    throw new Error("Only an integrity-checked scientific projection can be exported.");
  }
  const { view } = snapshot;
  const expected: Record<ExplorerResult["kind"], string> = {
    protein: "protein_properties", pairwise: "pairwise_alignment",
    msa: "multiple_sequence_alignment", tree: "phylogenetic_tree",
    insights: "sequence_insights",
  };
  if (!view || expected[view.kind] !== snapshot.jobType) {
    throw new Error("Result type and verification context disagree.");
  }
  const rows: Array<Array<string | number | null>> = [
    ["Genithm verified scientific viewer snapshot (bounded, not full artifact)"],
    ["Result SHA-256", snapshot.sha256],
    ["Verification", snapshot.verification],
    ["Job type", snapshot.jobType],
    ["Notice", "Downloaded data are the current verified explorer projection, not necessarily the full scientific artifact."],
    [],
    ["Section", "Field", "Value", "Detail"],
  ];
  const add = (section: string, field: string, value: string | number | null, detail = "") =>
    rows.push([section, field, value, detail]);

  if (view.kind === "pairwise") {
    add("Alignment", "Window start (1-based)", view.offset + 1);
    add("Alignment", "Total columns", view.total);
    add("Alignment", "Exact matches", view.match);
    add("Alignment", "Mismatches", view.mismatch);
    add("Alignment", "Gap columns", view.gaps);
    add("Alignment viewport", "Sequence A", view.a);
    add("Alignment viewport", "Concordance", view.markers);
    add("Alignment viewport", "Sequence B", view.b);
  } else if (view.kind === "msa") {
    add("MSA", "Window start (1-based)", view.offset + 1);
    add("MSA", "Total columns", view.total);
    add("MSA", "Sequence count", view.sequenceCount);
    add("MSA", "Row offset", view.rowOffset);
    add("MSA", "Conservation sampled", view.sampled ? "yes" : "no");
    for (const row of view.rows) add("MSA viewport", row.id, row.bases);
    for (const sample of view.samples) {
      add("Conservation sample", String(sample.position), sample.conservation, "Gap fraction: " + sample.gapFraction);
    }
  } else if (view.kind === "tree") {
    add("Phylogeny", "Model", view.model);
    add("Phylogeny", "Leaves", view.leaves);
    for (const node of view.nodes) {
      add("Tree node", String(node.id), node.label ?? "internal",
        "Parent: " + (node.parent ?? "none") + "; length: " + node.length + "; support: " + (node.support ?? "not recorded"));
    }
  } else if (view.kind === "insights") {
    add("Sequence", "Operation", view.operation);
    add("Sequence", "Type", view.sequenceType);
    add("Sequence", "Length", view.sequenceLength);
    if (view.totalHits !== null) add("Sequence", "Total findings", view.totalHits);
    add("Sequence", "Evidence truncated", view.truncated ? "yes" : "no");
    if (view.sampleSequence !== null) add("Sequence viewport", "Bases", view.sampleSequence);
    for (const row of view.records) add("Finding", row.label, row.detail, row.sequence ?? "");
  } else if (view.kind === "protein") {
    add("Protein", "Length (aa)", view.length);
    for (const property of view.properties) add("Protein property", property.label, property.value);
    for (const residue of view.composition) add("Amino-acid count", residue.residue, residue.count);
  }
  return rows.map(cells => cells.map(safeCell).join("\t")).join("\n") + "\n";
}
