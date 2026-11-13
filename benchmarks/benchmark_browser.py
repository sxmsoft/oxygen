#!/usr/bin/env python3
"""
Oxygen Browser RAM & CPU Benchmark Infrastructure.

Measures cold startup latency, idle CPU utilization, and process-tree memory
(RSS, PSS, and Private Dirty/Clean USS via /proc/<pid>/smaps_rollup) under
identical conditions so Oxygen can be compared directly against unmodified Helium.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import shutil
import socketserver
import subprocess
import tempfile
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

CLK_TCK = os.sysconf(os.sysconf_names["SC_CLK_TCK"])
REPO_ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = REPO_ROOT / "benchmarks" / "reports"


@dataclass
class ProcessTreeMetrics:
    process_count: int
    rss_kb: int
    pss_kb: int
    uss_kb: int
    cpu_ticks: int


@dataclass
class BenchmarkRunResult:
    label: str
    binary: str
    startup_ms: float
    idle_cpu_percent: float
    idle_rss_mb: float
    idle_pss_mb: float
    idle_uss_mb: float
    workload_rss_mb: float
    workload_pss_mb: float
    workload_cpu_percent: float
    process_count_idle: int
    process_count_workload: int


def get_descendant_pids(root_pid: int) -> list[int]:
    """Return root_pid and all descendant PIDs by scanning /proc/*/stat."""
    children_map: dict[int, list[int]] = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        pid = int(entry)
        try:
            with open(f"/proc/{pid}/stat", "r", encoding="utf-8") as fh:
                raw = fh.read()
            rparen = raw.rfind(")")
            if rparen == -1:
                continue
            fields = raw[rparen + 2 :].split()
            ppid = int(fields[1])
            children_map.setdefault(ppid, []).append(pid)
        except (FileNotFoundError, ProcessLookupError, ValueError, IndexError):
            continue

    result = [root_pid]
    queue = [root_pid]
    while queue:
        cur = queue.pop()
        for child in children_map.get(cur, []):
            result.append(child)
            queue.append(child)
    return result


def read_proc_smaps_rollup(pid: int) -> tuple[int, int, int]:
    """Return (rss_kb, pss_kb, uss_kb) from /proc/<pid>/smaps_rollup (fallback /status)."""
    rollup = Path(f"/proc/{pid}/smaps_rollup")
    rss_kb = pss_kb = priv_clean = priv_dirty = 0
    try:
        for line in rollup.read_text(encoding="utf-8").splitlines():
            if line.startswith("Rss:"):
                rss_kb = int(line.split()[1])
            elif line.startswith("Pss:"):
                pss_kb = int(line.split()[1])
            elif line.startswith("Private_Clean:"):
                priv_clean = int(line.split()[1])
            elif line.startswith("Private_Dirty:"):
                priv_dirty = int(line.split()[1])
        return rss_kb, pss_kb, priv_clean + priv_dirty
    except (FileNotFoundError, PermissionError, ProcessLookupError, ValueError):
        status = Path(f"/proc/{pid}/status")
        try:
            for line in status.read_text(encoding="utf-8").splitlines():
                if line.startswith("VmRSS:"):
                    rss_kb = int(line.split()[1])
                    return rss_kb, rss_kb, rss_kb
        except (FileNotFoundError, PermissionError, ProcessLookupError, ValueError):
            pass
    return 0, 0, 0


def read_proc_cpu_ticks(pid: int) -> int:
    """Return utime + stime clock ticks for pid."""
    try:
        raw = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
        rparen = raw.rfind(")")
        fields = raw[rparen + 2 :].split()
        utime = int(fields[11])
        stime = int(fields[12])
        return utime + stime
    except (FileNotFoundError, ProcessLookupError, ValueError, IndexError):
        return 0


def sample_process_tree(root_pid: int) -> ProcessTreeMetrics:
    pids = get_descendant_pids(root_pid)
    rss = pss = uss = ticks = 0
    alive = 0
    for pid in pids:
        r, p, u = read_proc_smaps_rollup(pid)
        t = read_proc_cpu_ticks(pid)
        if r > 0 or t > 0:
            alive += 1
        rss += r
        pss += p
        uss += u
        ticks += t
    return ProcessTreeMetrics(
        process_count=alive,
        rss_kb=rss,
        pss_kb=pss,
        uss_kb=uss,
        cpu_ticks=ticks,
    )


class _QuietHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = (
            "<!doctype html><html><head><title>Oxygen Bench</title></head>"
            "<body><h1>Oxygen Deterministic Benchmark Page</h1>"
            "<p>Static payload for zero-network CPU/RAM benchmarking.</p></body></html>"
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def start_local_fixture_server() -> tuple[socketserver.TCPServer, int]:
    server = socketserver.TCPServer(("127.0.0.1", 0), _QuietHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def measure_cpu_and_memory(pid: int, window_sec: float) -> tuple[ProcessTreeMetrics, float]:
    start_metrics = sample_process_tree(pid)
    t0 = time.monotonic()
    time.sleep(window_sec)
    elapsed = max(0.001, time.monotonic() - t0)
    end_metrics = sample_process_tree(pid)
    delta_ticks = max(0, end_metrics.cpu_ticks - start_metrics.cpu_ticks)
    cpu_pct = (delta_ticks / CLK_TCK) / elapsed * 100.0
    return end_metrics, round(cpu_pct, 2)


def benchmark_binary(
    label: str,
    binary: str,
    idle_window_sec: float = 4.0,
    workload_window_sec: float = 4.0,
    headless: bool = True,
) -> BenchmarkRunResult:
    resolved = shutil.which(binary) or binary
    if not Path(resolved).exists():
        raise FileNotFoundError(f"Browser binary not found: {binary}")

    profile_idle = tempfile.mkdtemp(prefix=f"ox-bench-{label}-idle-")
    profile_work = tempfile.mkdtemp(prefix=f"ox-bench-{label}-work-")
    server, port = start_local_fixture_server()

    common_flags = [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
    ]
    if headless:
        common_flags.append("--headless=new")

    try:
        # 1. Idle run & startup timing
        t_start = time.monotonic()
        proc_idle = subprocess.Popen(
            [resolved, f"--user-data-dir={profile_idle}", *common_flags, "about:blank"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Wait briefly until browser spawns renderer/main RSS stabilizes
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            m = sample_process_tree(proc_idle.pid)
            if m.process_count >= 2 and m.rss_kb > 20_000:
                break
            time.sleep(0.05)
        startup_ms = round((time.monotonic() - t_start) * 1000.0, 1)

        idle_metrics, idle_cpu = measure_cpu_and_memory(proc_idle.pid, idle_window_sec)
        proc_idle.terminate()
        try:
            proc_idle.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc_idle.kill()

        # 2. Multi-tab local fixture workload (5 tabs)
        urls = [f"http://127.0.0.1:{port}/tab-{i}" for i in range(1, 6)]
        proc_work = subprocess.Popen(
            [resolved, f"--user-data-dir={profile_work}", *common_flags, *urls],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(2.5)
        work_metrics, work_cpu = measure_cpu_and_memory(proc_work.pid, workload_window_sec)
        proc_work.terminate()
        try:
            proc_work.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc_work.kill()

        return BenchmarkRunResult(
            label=label,
            binary=resolved,
            startup_ms=startup_ms,
            idle_cpu_percent=idle_cpu,
            idle_rss_mb=round(idle_metrics.rss_kb / 1024.0, 2),
            idle_pss_mb=round(idle_metrics.pss_kb / 1024.0, 2),
            idle_uss_mb=round(idle_metrics.uss_kb / 1024.0, 2),
            workload_rss_mb=round(work_metrics.rss_kb / 1024.0, 2),
            workload_pss_mb=round(work_metrics.pss_kb / 1024.0, 2),
            workload_cpu_percent=work_cpu,
            process_count_idle=idle_metrics.process_count,
            process_count_workload=work_metrics.process_count,
        )
    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(profile_idle, ignore_errors=True)
        shutil.rmtree(profile_work, ignore_errors=True)


def write_comparison_report(
    baseline: BenchmarkRunResult,
    oxygen: BenchmarkRunResult,
    out_dir: Path = REPORTS_DIR,
) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    delta_idle_pss_mb = round(oxygen.idle_pss_mb - baseline.idle_pss_mb, 2)
    delta_work_pss_mb = round(oxygen.workload_pss_mb - baseline.workload_pss_mb, 2)
    delta_idle_cpu = round(oxygen.idle_cpu_percent - baseline.idle_cpu_percent, 2)
    within_budget = delta_idle_pss_mb <= 20.0

    payload = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "target_incremental_memory_mb": 20.0,
        "baseline": asdict(baseline),
        "oxygen": asdict(oxygen),
        "delta": {
            "idle_pss_mb": delta_idle_pss_mb,
            "workload_pss_mb": delta_work_pss_mb,
            "idle_cpu_percent": delta_idle_cpu,
            "startup_ms": round(oxygen.startup_ms - baseline.startup_ms, 1),
            "within_20mb_budget": within_budget,
        },
    }

    json_path = out_dir / f"benchmark-{ts}.json"
    md_path = out_dir / f"benchmark-{ts}.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    md = f"""# Oxygen vs Helium Benchmark Report ({ts})

| Metric | {baseline.label} | {oxygen.label} | Delta |
| --- | ---: | ---: | ---: |
| Startup (ms) | {baseline.startup_ms} | {oxygen.startup_ms} | {payload['delta']['startup_ms']:+.1f} |
| Idle PSS (MB) | {baseline.idle_pss_mb} | {oxygen.idle_pss_mb} | {delta_idle_pss_mb:+.2f} |
| Idle RSS (MB) | {baseline.idle_rss_mb} | {oxygen.idle_rss_mb} | {oxygen.idle_rss_mb - baseline.idle_rss_mb:+.2f} |
| Idle CPU (%) | {baseline.idle_cpu_percent} | {oxygen.idle_cpu_percent} | {delta_idle_cpu:+.2f} |
| 5-Tab PSS (MB) | {baseline.workload_pss_mb} | {oxygen.workload_pss_mb} | {delta_work_pss_mb:+.2f} |
| 5-Tab CPU (%) | {baseline.workload_cpu_percent} | {oxygen.workload_cpu_percent} | {oxygen.workload_cpu_percent - baseline.workload_cpu_percent:+.2f} |

**20 MB Incremental Memory Budget:** {"PASS" if within_budget else "FAIL"}
"""
    md_path.write_text(md, encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Oxygen Browser RAM & CPU Benchmark Suite")
    parser.add_argument("--binary", help="Single browser binary to benchmark")
    parser.add_argument("--helium", help="Baseline Helium binary path")
    parser.add_argument("--oxygen", help="Oxygen binary path")
    parser.add_argument("--window", type=float, default=4.0, help="Sampling window in seconds")
    parser.add_argument("--headed", action="store_true", help="Run without --headless=new")
    args = parser.parse_args()

    headless = not args.headed

    if args.helium and args.oxygen:
        base_res = benchmark_binary("Helium", args.helium, args.window, args.window, headless)
        ox_res = benchmark_binary("Oxygen", args.oxygen, args.window, args.window, headless)
        json_path, md_path = write_comparison_report(base_res, ox_res)
        print(md_path.read_text(encoding="utf-8"))
        print(f"Saved JSON: {json_path}")
        return 0

    if args.binary:
        res = benchmark_binary("Browser", args.binary, args.window, args.window, headless)
        print(json.dumps(asdict(res), indent=2))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
