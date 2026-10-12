from __future__ import annotations

import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "scientific-worker"))
from genithm_scientific_worker import codespaces_msa as science

FIXTURE = ">alpha\nACGTACGT\n>beta\nACGTTGGT\n>gamma\nACGTACGA\n>delta\nACGTACGG\n"

def make_request(operation="msa_conservation", source=FIXTURE, sequence_type="dna"):
    return {"sequence": source, "sequence_type": sequence_type,
            "operation": operation, "motif": None, "min_aa": 30}

def pretend_mafft(original, *, timeout_seconds=22):
    assert len(original) == 4
    return "".join(f">seq{i}\n{seq}\n" for i, seq in enumerate(original, 1)).encode("ascii")

class CodespacesMsaScientificTests(unittest.TestCase):
    def test_record_validation_and_limits(self):
        records = science.parse_records(FIXTURE, "dna")
        self.assertEqual(len(records), 4)
        self.assertEqual(records[1].name, "beta")
        invalid = [
            ">one\nATG\n>one\nATG\n>three\nATG",
            ">one\nATG\n>two\nATG",
            ">one\nATG\n>two\nAT-G\n>three\nATG",
            ">one\nATG\n>two\nATG\n>three\nATG!",
            ">bad name\nATG\n>two\nATG\n>three\nATG",
            ">one\n" + "A" * 301 + "\n>two\nATG\n>three\nATG",
        ]
        for sample in invalid:
            with self.subTest(sample=sample[:32]), self.assertRaises(ValueError):
                science.parse_records(sample, "dna")

    def test_mafft_conservation(self):
        with patch.object(science, "run_mafft", side_effect=pretend_mafft):
            output = science.run_local_msa(make_request())
        self.assertEqual(output["summary"]["sequence_count"], 4)
        self.assertEqual(output["summary"]["alignment_columns"], 8)
        self.assertEqual(output["summary"]["completely_conserved_columns"], 5)
        self.assertEqual(output["summary"]["variable_columns"], 3)
        self.assertEqual(output["result"]["consensus"], "ACGTACGN")
        self.assertIsNone(output["result"]["tree"])
        self.assertEqual(len(output["input_sha256"]), 64)
        self.assertEqual(output["persistence"], "none")

    def test_fasttree_result_verified(self):
        tree = "((seq1:0.1,seq2:0.2)0.89:0.1,(seq3:0.04,seq4:0.05)0.92:0.1);"
        with patch.object(science, "run_mafft", side_effect=pretend_mafft), \
             patch.object(science, "_run_fasttree", return_value=tree):
            output = science.run_local_msa(make_request("msa_phylogeny"))
        self.assertEqual(output["result"]["newick"], tree)
        self.assertEqual(len(output["result"]["tree"]["children"]), 2)
        self.assertEqual(output["result"]["tree"]["children"][0]["support"], 0.89)

    def test_unknown_and_gap_columns(self):
        output = science.conservation_profile(["AN-", "AT-", "AG-"], ["a","b","c"])
        self.assertEqual(output["statistics"]["completely_conserved_columns"], 1)
        self.assertEqual(output["consensus"], "ANN")
        self.assertEqual(output["sites"][2]["gap_percent"], 100)
        self.assertIsNone(output["sites"][2]["conservation_percent"])

    def test_parsimony_informative_site(self):
        output = science.conservation_profile(["A","A","C","C"], ["a","b","c","d"])
        self.assertEqual(output["statistics"]["parsimony_informative_columns"], 1)
        self.assertEqual(output["sites"][0]["conservation_percent"], 50)
        self.assertEqual(output["consensus"], "N")

    def test_newick_rejects_injected_malformed_and_duplicate_tips(self):
        for raw in [
            "(seq1:0.1,seq1:0.2,seq3:0.4);",
            "(seq1:0.1,seq2:0.2);",
            "(seq1:0.1,seq2:0.2,evil:0.4);",
            "(seq1:-0.1,seq2:0.2,seq3:0.4);",
            "(seq1:NaN,seq2:0.2,seq3:0.4);",
            "(seq1:0.1,seq2:0.2,seq3:0.4);system",
            "((seq1:0.1,seq2:0.1)evil:0.2,seq3:0.4);",
        ]:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                science._Newick(raw, ["a","b","c"]).parse()

    def test_fail_closed_parameters(self):
        for changes in [
            {"motif": "ATG"}, {"min_aa": True}, {"min_aa": 2},
            {"operation": ["unhashable"]}, {"operation": "shell"},
            {"extra_field": "x"},
        ]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                science.run_local_msa({**make_request(), **changes})

    def test_rna_normalization_and_alphabet(self):
        sample = ">a\nAUGC\n>b\nAUGU\n>c\nAUGA"
        self.assertEqual(science.parse_records(sample, "rna")[0].sequence, "AUGC")
        with self.assertRaises(ValueError):
            science.parse_records(sample, "dna")

    def test_mafft_failure_does_not_yield_fake_science(self):
        with patch.object(science, "run_mafft", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(ValueError, "MAFFT unavailable"):
                science.run_local_msa(make_request())

if __name__ == "__main__":
    unittest.main()
