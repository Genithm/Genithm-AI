"""V56: locally executable science must not quietly become an unchecked worker job."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "ai-worker"))
from genithm_ai_worker.capability_registry import get_capability, executable_action_types


class LocalAnalysisRegistry(unittest.TestCase):
    def test_two_real_bounded_local_engines(self):
        for capability_id in ("differential_expression", "pathway_analysis"):
            cap = get_capability(capability_id)
            self.assertEqual(cap.status, "available")
            self.assertEqual(cap.execution_kind, "local")
            self.assertIsNone(cap.action_type)
            self.assertNotIn(capability_id, executable_action_types())

    def test_raw_fastq_quantification_remains_planned(self):
        cap = get_capability("rna_seq_quantification")
        self.assertEqual(cap.status, "planned")
        self.assertIsNone(cap.action_type)

    def test_existing_server_science_is_not_modified(self):
        actions = executable_action_types()
        for action in ("blast", "pairwise_alignment", "multiple_sequence_alignment", "phylogenetic_tree"):
            self.assertIn(action, actions)


if __name__ == "__main__":
    unittest.main()
