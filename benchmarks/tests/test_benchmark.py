import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmark_browser import (
    BenchmarkRunResult,
    benchmark_binary,
    measure_cpu_and_memory,
    sample_process_tree,
    write_comparison_report,
)


class BenchmarkInfraTests(unittest.TestCase):
    def test_sample_process_tree_and_cpu(self) -> None:
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(2)"])
        try:
            metrics, cpu = measure_cpu_and_memory(proc.pid, 0.3)
            self.assertGreaterEqual(metrics.process_count, 1)
            self.assertGreater(metrics.rss_kb, 0)
            self.assertGreater(metrics.pss_kb, 0)
            self.assertGreaterEqual(cpu, 0.0)
        finally:
            proc.terminate()
            proc.wait(timeout=3)

    def test_comparison_report_budget_check(self) -> None:
        base = BenchmarkRunResult(
            label="Helium",
            binary="/usr/bin/helium",
            startup_ms=420.0,
            idle_cpu_percent=0.2,
            idle_rss_mb=150.0,
            idle_pss_mb=120.0,
            idle_uss_mb=105.0,
            workload_rss_mb=320.0,
            workload_pss_mb=270.0,
            workload_cpu_percent=1.1,
            process_count_idle=5,
            process_count_workload=10,
        )
        oxygen = BenchmarkRunResult(
            label="Oxygen",
            binary="/usr/bin/oxygen",
            startup_ms=435.0,
            idle_cpu_percent=0.25,
            idle_rss_mb=161.0,
            idle_pss_mb=131.5,
            idle_uss_mb=116.0,
            workload_rss_mb=334.0,
            workload_pss_mb=282.0,
            workload_cpu_percent=1.15,
            process_count_idle=5,
            process_count_workload=10,
        )
        with tempfile.TemporaryDirectory() as tmp:
            jpath, mpath = write_comparison_report(base, oxygen, Path(tmp))
            self.assertTrue(jpath.exists())
            self.assertTrue(mpath.exists())
            self.assertIn("PASS", mpath.read_text(encoding="utf-8"))

    def test_extension_dir_without_manifest_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileNotFoundError):
                benchmark_binary("x", sys.executable, extensions=[tmp])


if __name__ == "__main__":
    unittest.main()
