from __future__ import annotations

import json
import runpy
import unittest
from pathlib import Path

ENGINE = runpy.run_path(str(Path(__file__).with_name("codespaces-live-science.py")))
compute = ENGINE["compute"]

BASE = {
    "sequence": ">test\nATGAAATAA",
    "sequence_type": "dna",
    "operation": "orf_scan",
    "motif": None,
    "min_aa": 2,
}


class CodespacesLiveScienceTests(unittest.TestCase):
    def test_orf_computes_real_peptide_and_coordinates(self) -> None:
        output = compute(BASE)
        self.assertEqual(output["summary"]["orf_count"], 1)
        self.assertEqual(output["result"]["orfs"][0]["protein"], "MK")
        self.assertEqual(output["result"]["orfs"][0]["start_1based"], 1)
        self.assertEqual(output["result"]["orfs"][0]["end_1based"], 9)
        self.assertEqual(output["persistence"], "none")
        self.assertEqual(len(output["input_sha256"]), 64)

    def test_six_frame_translation(self) -> None:
        request = dict(BASE, operation="six_frame_translation", min_aa=30)
        output = compute(request)
        self.assertEqual(output["result"]["frames"][0]["protein"], "MK*")
        self.assertEqual(len(output["result"]["frames"]), 6)

    def test_motif_scan(self) -> None:
        output = compute(dict(BASE, operation="motif_scan", motif="AAA", min_aa=30))
        self.assertEqual(output["summary"]["motif_hits"], 1)
        self.assertEqual(output["result"]["hits"][0]["start_1based"], 4)

    def test_reverse_complement(self) -> None:
        output = compute(dict(BASE, operation="reverse_complement", min_aa=30))
        self.assertEqual(output["result"]["reverse_complement"], "TTATTTCAT")

    def test_rna(self) -> None:
        output = compute(dict(BASE, sequence="AUGAAAUAA", sequence_type="rna"))
        self.assertEqual(output["result"]["orfs"][0]["protein"], "MK")

    def test_plain_sequence_input(self) -> None:
        output = compute(dict(BASE, sequence="ATGAAATAA"))
        self.assertEqual(output["summary"]["sequence_length"], 9)

    def test_reject_oversized_and_malformed_sequences(self) -> None:
        for sequence in ("ATG" * 2000, "ACG-T", ">one\nATG\n>two\nTAA", "", "ATG X"):
            with self.subTest(sequence=sequence[:12]):
                with self.assertRaises(ValueError):
                    compute(dict(BASE, sequence=sequence))

    def test_reject_wrong_alphabet(self) -> None:
        with self.assertRaises(ValueError):
            compute(dict(BASE, sequence="AUGAAAUAA", sequence_type="dna"))

    def test_reject_unapproved_operations_and_contract_drift(self) -> None:
        for extra in (
            dict(BASE, operation="arbitrary_code"),
            dict(BASE, motif="AAA"),
            dict(BASE, min_aa=True),
            dict(BASE, min_aa=0),
            dict(BASE, sequence_type="protein"),
            dict(BASE, operation="motif_scan", motif="AT*"),
            dict(BASE, operation="six_frame_translation", min_aa=2),
            dict(BASE, shell="rm -rf /"),
        ):
            with self.subTest(extra=str(extra)[:40]):
                with self.assertRaises(ValueError):
                    compute(extra)

    def test_output_is_deterministic(self) -> None:
        self.assertEqual(
            json.dumps(compute(BASE), sort_keys=True),
            json.dumps(compute(BASE), sort_keys=True),
        )


if __name__ == "__main__":
    unittest.main()
