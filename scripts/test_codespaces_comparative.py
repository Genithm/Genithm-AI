from __future__ import annotations

import json
import runpy
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = runpy.run_path(str(ROOT / "scripts/codespaces-live-science.py"))
compute = ENGINE["compute"]


def request(fasta: str, operation: str = "pairwise_global", *, sequence_type: str = "dna") -> dict[str, object]:
    return {"sequence": fasta, "operation": operation, "sequence_type": sequence_type, "motif": None, "min_aa": 30}


PAIR = ">a\nACGTTGCA\n>b\nACGTCGCA"
MATRIX = ">a\nAAAA\n>b\nAAAT\n>c\nAATT"


class CodespacesComparativeAnalysisTests(unittest.TestCase):
    def test_global_alignment_reports_correct_identity_mismatch_and_exportable_strings(self):
        output = compute(request(PAIR))
        summary, result = output["summary"], output["result"]
        self.assertEqual(summary["sequence_count"], 2)
        self.assertEqual(summary["alignment_length"], 8)
        self.assertEqual(summary["matches"], 7)
        self.assertEqual(summary["mismatches"], 1)
        self.assertEqual(summary["gap_columns"], 0)
        self.assertEqual(summary["identity_percent"], 87.5)
        self.assertEqual(summary["coverage_a_percent"], 100.0)
        self.assertEqual(summary["coverage_b_percent"], 100.0)
        self.assertEqual(result["aligned_a"], "ACGTTGCA")
        self.assertEqual(result["aligned_b"], "ACGTCGCA")
        self.assertEqual(result["comparison"], "||||.|||")
        self.assertEqual(output["tool"]["id"], "genithm-pairwise-aligner")
        self.assertEqual(output["genetic_code"], None)

    def test_insertion_and_gap_summary(self):
        output = compute(request(">ref\nACGT\n>query\nAGT"))
        self.assertEqual(output["summary"]["matches"], 3)
        self.assertEqual(output["summary"]["gap_columns"], 1)
        self.assertEqual(output["summary"]["alignment_length"], 4)
        self.assertEqual(output["summary"]["coverage_a_percent"], 100)
        self.assertEqual(output["summary"]["coverage_b_percent"], 100)

    def test_local_alignment_returns_best_scoring_segment(self):
        output = compute(request(">ref\nGGGACGTCCC\n>query\nTTACGTAA", "pairwise_local"))
        self.assertEqual(output["result"]["aligned_a"], "ACGT")
        self.assertEqual(output["result"]["aligned_b"], "ACGT")
        self.assertEqual(output["summary"]["score"], 8)
        self.assertEqual(output["summary"]["identity_percent"], 100)
        self.assertEqual(output["summary"]["coverage_a_percent"], 40)
        self.assertEqual(output["summary"]["coverage_b_percent"], 50)

    def test_local_alignment_no_matches(self):
        output = compute(request(">ref\nAAAA\n>query\nCCCC", "pairwise_local"))
        self.assertEqual(output["result"]["aligned_a"], "")
        self.assertEqual(output["summary"]["alignment_length"], 0)
        self.assertEqual(output["summary"]["identity_percent"], 0)

    def test_matrix_symmetric_identity_and_complete_pairs(self):
        output = compute(request(MATRIX, "comparison_matrix"))
        s, r = output["summary"], output["result"]
        self.assertEqual(s["sequence_count"], 3)
        self.assertEqual(s["comparisons"], 3)
        self.assertEqual(r["identity_matrix"], [
            [100.0, 75.0, 50.0],
            [75.0, 100.0, 75.0],
            [50.0, 75.0, 100.0],
        ])
        self.assertEqual(len(r["pairs"]), 3)
        self.assertIn("not an MSA or phylogeny", r["method"])

    def test_matrix_boundary_six_150_base_sequences(self):
        records = "\n".join(f">seq{i}\n" + ("ACGT" * 37 + "AC") for i in range(6))
        output = compute(request(records, "comparison_matrix"))
        self.assertEqual(output["summary"]["comparisons"], 15)
        self.assertEqual(len(output["result"]["identity_matrix"]), 6)
        self.assertTrue(all(all(score == 100 for score in row) for row in output["result"]["identity_matrix"]))

    def test_rna_alignment_supported(self):
        output = compute(request(">a\nAUGC\n>b\nAUGU", sequence_type="rna"))
        self.assertEqual(output["summary"]["sequence_type"], "rna")
        self.assertEqual(output["summary"]["identity_percent"], 75)

    def test_parse_multiline_fasta_and_uppercase_inputs(self):
        output = compute(request(">a\nacg\nt\n>b\nACGT"))
        self.assertEqual(output["summary"]["identity_percent"], 100)
        self.assertEqual(output["result"]["record_a"]["name"], "a")

    def test_reject_bad_record_count_and_duplicate_ids(self):
        fixtures = (
            (">a\nATGC", "pairwise_global"),
            (">a\nATGC\n>a\nATGC", "pairwise_global"),
            (">a\nATGC\n>b\nATGC\n>c\nATGC", "pairwise_global"),
            (">a\nATGC\n>b\nATGC", "comparison_matrix"),
            ("ATGC\n>a\nATGC", "pairwise_global"),
            (">bad name\nATGC\n>b\nATGC", "pairwise_global"),
            (">a\nATGC\n>b\nAT-G", "pairwise_global"),
            (">a\nATGC\n>b\nATGX", "pairwise_global"),
            (">a\nATGC\n>b\nATGC\n>c\nATGC\n>d\nATGC\n>e\nATGC\n>f\nATGC\n>g\nATGC", "comparison_matrix"),
        )
        for fasta, operation in fixtures:
            with self.subTest(fasta=fasta[:30]):
                with self.assertRaises(ValueError):
                    compute(request(fasta, operation))

    def test_reject_per_record_size_bounds(self):
        with self.assertRaises(ValueError):
            compute(request(">a\n" + "A" * 701 + "\n>b\nAAAA"))
        with self.assertRaises(ValueError):
            compute(request(">a\n" + "A" * 151 + "\n>b\nAAAA\n>c\nAAAA", "comparison_matrix"))

    def test_comparison_parameters_fail_closed(self):
        for changes in (
            {"motif": "AAA"},
            {"min_aa": 2},
            {"min_aa": True},
            {"operation": "arbitrary_code"},
            {"sequence_type": "protein"},
            {"shell": "malicious"},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    compute({**request(PAIR), **changes})

    def test_deterministic_lineage_and_existing_method_compatibility(self):
        one = compute(request(PAIR))
        two = compute(request(PAIR))
        self.assertEqual(json.dumps(one, sort_keys=True), json.dumps(two, sort_keys=True))
        self.assertEqual(len(one["input_sha256"]), 64)
        self.assertEqual(one["persistence"], "none")
        other = compute({"sequence": "ATGAAATAA", "sequence_type": "dna", "operation": "orf_scan", "motif": None, "min_aa": 2})
        self.assertEqual(other["result"]["orfs"][0]["protein"], "MK")


if __name__ == "__main__":
    unittest.main()
