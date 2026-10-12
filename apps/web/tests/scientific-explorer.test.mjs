import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExplorerArtifactError, projectScientificArtifact } from "../lib/scientific-result-explorer.ts";

const encode = data => new TextEncoder().encode(data).buffer;
const json = data => encode(JSON.stringify(data));
const request = (type, bytes, summary, offset = 0, row = 0) =>
  projectScientificArtifact(type, bytes, { ...summary, job_type: type }, offset, row);

describe("Science V9 verified artifact projections", () => {
  it("pages real pairwise alignment windows and distinguishes gaps, matches and mismatches", () => {
    const a = "ACGT" + "A".repeat(120);
    const b = "AC-T" + "T".repeat(120);
    const art = json({
      summary: { job_type: "pairwise_alignment", aligned_length: a.length },
      alignment: { sequence_a: a, sequence_b: b },
    });
    const s = { aligned_length: a.length, matches: 3, mismatches: 120, gaps: 1 };
    const first = request("pairwise_alignment", art, s);
    assert.equal(first.kind, "pairwise");
    assert.equal(first.total, 124);
    assert.equal(first.markers.slice(0, 4), "|| |");
    assert.equal(first.a.length, 96);
    const last = request("pairwise_alignment", art, s, 96);
    assert.equal(last.offset, 96);
    assert.equal(last.a.length, 28);
    assert.throws(() => request("pairwise_alignment", art, s, -1), ExplorerArtifactError);
    assert.throws(() => request("pairwise_alignment", art, { ...s, aligned_length: 999 }), ExplorerArtifactError);
  });

  it("derives reproducible sampled conservation from all rows, not just the visible viewport", () => {
    const msa = encode(">seq1\nACGT\n>seq2\nACCT\n>seq3\nAGGT\n");
    const view = request("multiple_sequence_alignment", msa, { sequence_count: 3, aligned_length: 4 });
    assert.equal(view.kind, "msa");
    assert.deepEqual(view.rows.map(x => x.id), ["seq1", "seq2", "seq3"]);
    assert.equal(view.samples.length, 4);
    assert.equal(view.samples[0].conservation, 1);
    assert.equal(view.samples[1].conservation, 2 / 3);
    assert.equal(view.samples[2].conservation, 2 / 3);
    assert.equal(view.sampled, false);
  });

  it("constrains MSA records, alphabets, count and pagination", () => {
    const seq = "ACGT".repeat(80);
    const msa = encode(Array.from({ length: 15 }, (_, i) => ">seq" + (i + 1) + "\n" + seq + "\n").join(""));
    const last = request("multiple_sequence_alignment", msa, { sequence_count: 15, aligned_length: 320 }, 96, 12);
    assert.equal(last.kind, "msa");
    assert.equal(last.rows.length, 3);
    assert.equal(last.offset, 96);
    assert.equal(last.rows[0].bases.length, 96);
    assert.equal(last.samples.length, 128);
    assert.equal(last.sampled, true);
    assert.throws(() => request("multiple_sequence_alignment",
      encode(">seq1\nACGT\n>seq2\nACGT\n>seq2\nACGT\n"),
      { sequence_count: 3, aligned_length: 4 }), ExplorerArtifactError);
    assert.throws(() => request("multiple_sequence_alignment",
      encode(">seq1\nACGT\n>seq2\nAC#T\n>seq3\nACGT\n"),
      { sequence_count: 3, aligned_length: 4 }), ExplorerArtifactError);
    assert.throws(() => request("multiple_sequence_alignment", msa,
      { sequence_count: 15, aligned_length: 320 }, 0, 50), ExplorerArtifactError);
  });

  it("parses canonical FastTree Newick into bounded graph nodes with support", () => {
    const source = encode("((seq1:0.1,seq2:0.2)0.95:0.3,seq3:0.4);\n");
    const tree = request("phylogenetic_tree", source, { leaf_count: 3, model: "gtr_cat" });
    assert.equal(tree.kind, "tree");
    assert.equal(tree.nodes.length, 5);
    assert.equal(tree.nodes.filter(n => n.label).length, 3);
    assert.equal(tree.nodes.find(n => n.support !== null).support, 0.95);
    assert.deepEqual(tree.nodes.filter(n => n.label).map(n => n.label), ["seq1","seq2","seq3"]);
  });

  it("rejects malformed or dishonest tree evidence", () => {
    const summary = { leaf_count: 3, model: "jtt_cat" };
    for (const newick of [
      "(seq1:0.1,seq1:0.2,seq3:0.3);",
      "(seq1:0.1,seq2:0.2);",
      "(seq1:0.1,seq2:-0.3,seq3:0.3);",
      "((seq1:0.1,seq2:0.2)1.5:0.3,seq3:0.2);",
      "(seq1:0.1,seq2:0.2,seq3:0.3);extra",
      "(seq1:0.1,seq2:nan,seq3:0.3);",
    ]) assert.throws(() => request("phylogenetic_tree", encode(newick), summary), ExplorerArtifactError);
    assert.throws(() => request("phylogenetic_tree",
      encode("(seq1:0.1,seq2:0.2,seq3:0.3);"), { leaf_count: 4, model: "gtr_cat" }),
    ExplorerArtifactError);
  });

  it("projects sequence ORFs and motif hits with explicit inclusive coordinates", () => {
    const orf = request("sequence_insights", json({
      summary: { job_type: "sequence_insights" },
      result: { operation: "orf_scan", orfs: [{
        start_1based: 1, end_1based: 9, strand: "+", amino_acids: 2, protein: "MK",
      }], truncated: false },
    }), { operation: "orf_scan", sequence_length: 9, sequence_type: "dna", orf_count: 1 });
    assert.equal(orf.kind, "insights");
    assert.equal(orf.records[0].label, "Positions 1–9");
    assert.equal(orf.records[0].sequence, "MK");
    const motif = request("sequence_insights", json({
      summary: { job_type: "sequence_insights" },
      result: { operation: "motif_scan", hits: [{ start_1based: 2, end_1based: 5, strand: "-" }] },
    }), { operation: "motif_scan", sequence_length: 9, sequence_type: "dna", motif_hits: 1 });
    assert.equal(motif.totalHits, 1);
    assert.equal(motif.records[0].detail, "- strand");
  });

  it("projects reverse complement and all six translation frames", () => {
    const rc = request("sequence_insights", json({
      summary: { job_type: "sequence_insights" },
      result: { operation: "reverse_complement", reverse_complement: "ACGU" },
    }), { operation: "reverse_complement", sequence_length: 4, sequence_type: "rna" });
    assert.equal(rc.sampleSequence, "ACGU");
    assert.throws(() => request("sequence_insights", json({
      summary: { job_type: "sequence_insights" },
      result: { operation: "reverse_complement", reverse_complement: "AAAAAAAA" },
    }), { operation: "reverse_complement", sequence_length: 4, sequence_type: "dna" }), ExplorerArtifactError);

    const frames = Array.from({ length: 6 }, (_, i) => ({
      strand: i < 3 ? "+" : "-", frame: i % 3 + 1, protein: "MKK",
    }));
    const translated = request("sequence_insights", json({
      summary: { job_type: "sequence_insights" },
      result: { operation: "six_frame_translation", frames },
    }), { operation: "six_frame_translation", sequence_length: 12, sequence_type: "dna" });
    assert.equal(translated.records.length, 6);
    assert.equal(translated.totalHits, 6);
  });

  it("renders protein composition and physicochemical measures without changing units", () => {
    const summary = {
      length: 5, amino_acid_composition: { A: 2, C: 1, D: 2 },
      molecular_weight_da: 450.1, aromaticity_fraction: 0, gravy: -0.5,
      estimated_net_charge_ph7: -1.2, estimated_isoelectric_point: 3.2,
    };
    const view = request("protein_properties", json({
      summary: { ...summary, job_type: "protein_properties" },
    }), summary);
    assert.equal(view.kind, "protein");
    assert.equal(view.length, 5);
    assert.equal(view.composition.reduce((sum, r) => sum + r.count, 0), 5);
    assert.equal(view.properties.length, 5);
    assert.throws(() => request("protein_properties", json({summary: {job_type:"protein_properties"}}),
      { ...summary, length: 6 }), ExplorerArtifactError);
  });

  it("fails closed on unrelated artifacts, invalid metadata and absent output", () => {
    assert.throws(() => request("protein_properties", new ArrayBuffer(0), { length: 1 }), ExplorerArtifactError);
    assert.throws(() => request("unsupported", json({ summary: { job_type: "unsupported" } }), {}), ExplorerArtifactError);
    assert.throws(() => request("pairwise_alignment",
      json({ summary: { job_type: "sequence_insights" }, alignment: { sequence_a: "A", sequence_b: "A" } }),
      { aligned_length: 1 }), ExplorerArtifactError);
  });
});
