from __future__ import annotations

import json
import runpy
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = runpy.run_path(str(ROOT / "scripts" / "codespaces-live-science.py"))
compute = ENGINE["compute"]


def request(seq: str, sequence_type: str = "dna") -> dict[str, object]:
    return {
        "sequence": seq,
        "sequence_type": sequence_type,
        "operation": "composition_profile",
        "motif": None,
        "min_aa": 30,
    }


class CodespacesGenomicsQcTests(unittest.TestCase):
    def test_known_gc_entropy_and_cpg_ratio(self):
        out = compute(request("ACGCGTT"))
        s = out["summary"]
        self.assertEqual(s["sequence_length"], 7)
        self.assertEqual(s["gc_percent"], 57.14)
        self.assertEqual(s["at_percent"], 42.86)
        self.assertEqual(s["cpg_count"], 2)
        self.assertEqual(s["cpg_observed_expected"], 3.5)
        self.assertIsInstance(s["shannon_entropy_bits"], float)
        self.assertEqual(out["result"]["nucleotide_counts"], {"A": 1, "C": 2, "G": 2, "T": 2, "N": 0})
        self.assertEqual(out["result"]["gc_profile"][0]["gc_percent"], 57.14)

    def test_all_unknown_is_not_false_zero_gc(self):
        out = compute(request("NNNN"))
        self.assertIsNone(out["summary"]["gc_percent"])
        self.assertIsNone(out["summary"]["at_percent"])
        self.assertIsNone(out["summary"]["shannon_entropy_bits"])
        self.assertIsNone(out["summary"]["cpg_observed_expected"])
        self.assertEqual(out["summary"]["n_percent"], 100.0)
        self.assertIsNone(out["result"]["gc_profile"][0]["gc_percent"])

    def test_rna_uses_u_output_and_correct_codons(self):
        out = compute(request("AUGAAAUAA", "rna"))
        self.assertEqual(out["result"]["nucleotide_counts"], {"A": 6, "C": 0, "G": 1, "U": 2, "N": 0})
        self.assertEqual(
            {item["codon"]: item["amino_acid"] for item in out["result"]["codon_usage"]},
            {"AAA": "K", "ATG": "M", "TAA": "*"},
        )
        self.assertEqual(out["summary"]["gc_percent"], 11.11)
        self.assertEqual(out["result"]["trailing_bases_excluded_from_codon_usage"], 0)

    def test_overlapping_trinucleotides(self):
        out = compute(request("AAAAA"))
        self.assertEqual(out["result"]["top_trinucleotides"][0], {"kmer": "AAA", "count": 3})
        self.assertEqual(out["result"]["trailing_bases_excluded_from_codon_usage"], 2)

    def test_ambiguous_codons_are_not_misassigned(self):
        out = compute(request("ATGNNT"))
        self.assertEqual(out["result"]["ambiguous_codons"], 1)
        self.assertEqual(out["result"]["codon_usage"][0]["codon"], "ATG")
        self.assertEqual(out["result"]["nucleotide_counts"]["N"], 2)

    def test_coordinate_coverage_and_window_limits(self):
        sequence = "ACGT" * 1250
        out = compute(request(sequence))
        windows = out["result"]["gc_profile"]
        self.assertEqual(out["summary"]["gc_window_size"], 100)
        self.assertEqual(out["summary"]["gc_window_count"], len(windows))
        self.assertLessEqual(len(windows), 101)
        self.assertEqual(windows[0]["start_1based"], 1)
        self.assertEqual(windows[-1]["end_1based"], 5000)
        self.assertTrue(all(p["gc_percent"] == 50.0 for p in windows))
        self.assertEqual([p["start_1based"] for p in windows], sorted({p["start_1based"] for p in windows}))

    def test_tiny_sequence_and_empty_codon_set(self):
        out = compute(request("G"))
        self.assertEqual(out["summary"]["gc_percent"], 100.0)
        self.assertEqual(out["result"]["codon_usage"], [])
        self.assertEqual(out["result"]["gc_profile"][0]["start_1based"], 1)

    def test_invalid_inputs_still_fail_closed(self):
        for fields in (
            dict(request("ACGT"), motif="AA"),
            dict(request("ACGT"), min_aa=8),
            dict(request("ACGT"), operation="composition_profile", extra="injected"),
            request("ACGT" * 1251),
            request("ACGT-", "dna"),
        ):
            with self.subTest(fields=fields):
                with self.assertRaises(ValueError):
                    compute(fields)

    def test_deterministic_result_and_tool_identity(self):
        a = compute(request(">verified\nACGTACGT"))
        b = compute(request(">verified\nACGTACGT"))
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
        self.assertEqual(a["tool"]["id"], "genithm-local-composition")
        self.assertEqual(a["mode"], "local-development-only")
        self.assertEqual(a["persistence"], "none")
        self.assertEqual(len(a["input_sha256"]), 64)


if __name__ == "__main__":
    unittest.main()
