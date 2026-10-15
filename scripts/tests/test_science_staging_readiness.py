"""Deterministic, network-free V26 staging target safety tests."""
import importlib.util
from pathlib import Path
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "science_staging_readiness.py"
SPEC = importlib.util.spec_from_file_location("science_staging_readiness", MODULE_PATH)
science = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(science)

STAGE = "abcdefghijklmnopqrst"
PROD = "vowmjjgkjoxcvlfamukh"
URL = f"postgresql://audituser:private-password@db.{STAGE}.supabase.co:5432/postgres?sslmode=require"
MESSAGE = "11111111-1111-4111-8111-111111111111"
RUN = "22222222-2222-4222-8222-222222222222"


class StagingSafetyTests(unittest.TestCase):
    def test_valid_staging_readonly_input(self):
        science.validate_target(STAGE, PROD, URL)
        science.validate_target(STAGE, PROD, URL, MESSAGE, RUN)

    def test_identical_production_target_is_rejected(self):
        with self.assertRaises(science.UnsafeTarget):
            science.validate_target(STAGE, STAGE, URL)

    def test_missing_prod_guard_is_rejected(self):
        with self.assertRaises(science.UnsafeTarget):
            science.validate_target(STAGE, "", URL)

    def test_cross_project_url_is_rejected(self):
        for url in [
            URL.replace(STAGE, PROD),
            URL.replace("db.", "pooler."),
            "postgresql://u:p@localhost:5432/postgres?sslmode=require",
            URL.replace(":5432", ":6432"),
            URL.replace("/postgres?", "/other?"),
            URL.replace("postgresql:", "https:"),
            URL.replace("sslmode=require", "sslmode=disable"),
            URL.replace("sslmode=require", "sslmode=prefer"),
            URL.replace("?sslmode=require", ""),
        ]:
            with self.subTest(url=url.split("@")[-1]):
                with self.assertRaises(science.UnsafeTarget):
                    science.validate_target(STAGE, PROD, url)

    def test_partial_or_malformed_lineage_locators_are_rejected(self):
        for message, run in [
            (MESSAGE, ""), ("", RUN), ("invalid", RUN), (MESSAGE, "2'; select 1;--"),
        ]:
            with self.subTest(message=message, run=run):
                with self.assertRaises(science.UnsafeTarget):
                    science.validate_target(STAGE, PROD, URL, message, run)


if __name__ == "__main__":
    unittest.main()
