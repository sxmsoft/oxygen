#!/usr/bin/env python3
"""
Oxygen Browser RAM & CPU Benchmark Infrastructure.

Measures cold startup latency, idle CPU utilization, and process-tree memory
(RSS, PSS, and Private Dirty/Clean USS via /proc/<pid>/smaps_rollup) under
identical conditions so Helium + Oxygen extension can be compared against bare Helium.

All browsers run headless, at lowest CPU/IO priority (nice 19, ionice idle), with
throwaway profiles, so the user's own Helium session is never touched.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import shutil
import signal
import socketserver
import statistics
import subprocess
import tempfile
import threading
import time
import urllib.request
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
    ntp_pss_mb: float = 0.0
    ntp_rss_mb: float = 0.0
    iterations: int = 1
    extensions: tuple[str, ...] = ()


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


LOW_PRIORITY_PREFIX = ["nice", "-n", "19", "ionice", "-c3"]


def _launch(cmd: list[str], low_priority: bool) -> subprocess.Popen:
    # nice/ionice exec the browser, so proc.pid is the browser's own pid.
    return subprocess.Popen(
        [*LOW_PRIORITY_PREFIX, *cmd] if low_priority else cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _stop(proc: subprocess.Popen) -> None:
    """Stops only the browser we started (its own session / process group)."""
    try:
        proc.terminate()
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait(timeout=5)


def _wait_for_devtools(profile: str, timeout_sec: float = 20.0) -> int:
    """Returns the DevTools port once the browser main loop answers HTTP requests."""
    port_file = Path(profile) / "DevToolsActivePort"
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        try:
            port = int(port_file.read_text(encoding="utf-8").splitlines()[0])
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1):
                return port
        except (FileNotFoundError, ValueError, IndexError, OSError):
            time.sleep(0.02)
    raise TimeoutError("browser did not expose DevTools in time")


def _page_targets(port: int) -> list[dict]:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as r:
        return [t for t in json.loads(r.read()) if t.get("type") == "page"]


def _open_tab(port: int, url: str) -> None:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?{url}", method="PUT")
    urllib.request.urlopen(req, timeout=5).close()


def _start(base: list[str], profile: str, url: str, low_priority: bool) -> tuple[subprocess.Popen, int, float]:
    """Starts the browser on `url`; returns (proc, devtools_port, ms until first page target exists)."""
    (Path(profile) / "DevToolsActivePort").unlink(missing_ok=True)
    t0 = time.monotonic()
    proc = _launch([*base, "--remote-debugging-port=0", url], low_priority)
    try:
        port = _wait_for_devtools(profile)
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline and not _page_targets(port):
            time.sleep(0.02)
    except Exception:
        _stop(proc)
        raise
    return proc, port, (time.monotonic() - t0) * 1000.0


def _single_run(
    resolved: str,
    common_flags: list[str],
    port: int,
    idle_window_sec: float,
    workload_window_sec: float,
    low_priority: bool,
    settle_sec: float = 3.0,
) -> dict[str, float]:
    profile = tempfile.mkdtemp(prefix="ox-bench-")
    try:
        base = [resolved, f"--user-data-dir={profile}", *common_flags]

        # 0. Warm-up launch so first-run work (profile creation, extension install)
        #    is not counted in startup or steady-state memory.
        proc, _, _ = _start(base, profile, "about:blank", low_priority)
        time.sleep(settle_sec)
        _stop(proc)

        # 1. Startup (warm profile) + idle after settling
        proc, _, startup_ms = _start(base, profile, "about:blank", low_priority)
        time.sleep(settle_sec)
        idle_metrics, idle_cpu = measure_cpu_and_memory(proc.pid, idle_window_sec)
        _stop(proc)

        # 2. New tab page (Helium NTP vs Oxygen Control Center override)
        proc, _, _ = _start(base, profile, "chrome://newtab/", low_priority)
        time.sleep(settle_sec)
        ntp_metrics, _ = measure_cpu_and_memory(proc.pid, 1.0)
        _stop(proc)

        # 3. Multi-tab local fixture workload (5 tabs; headless allows one URL
        #    on the command line, the rest are opened over DevTools)
        proc, dport, _ = _start(base, profile, f"http://127.0.0.1:{port}/tab-1", low_priority)
        for i in range(2, 6):
            _open_tab(dport, f"http://127.0.0.1:{port}/tab-{i}")
        time.sleep(settle_sec)
        work_metrics, work_cpu = measure_cpu_and_memory(proc.pid, workload_window_sec)
        _stop(proc)

        mb = lambda kb: kb / 1024.0  # noqa: E731
        return {
            "startup_ms": startup_ms,
            "idle_cpu_percent": idle_cpu,
            "idle_rss_mb": mb(idle_metrics.rss_kb),
            "idle_pss_mb": mb(idle_metrics.pss_kb),
            "idle_uss_mb": mb(idle_metrics.uss_kb),
            "ntp_rss_mb": mb(ntp_metrics.rss_kb),
            "ntp_pss_mb": mb(ntp_metrics.pss_kb),
            "workload_rss_mb": mb(work_metrics.rss_kb),
            "workload_pss_mb": mb(work_metrics.pss_kb),
            "workload_cpu_percent": work_cpu,
            "process_count_idle": idle_metrics.process_count,
            "process_count_workload": work_metrics.process_count,
        }
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def benchmark_binary(
    label: str,
    binary: str,
    idle_window_sec: float = 4.0,
    workload_window_sec: float = 4.0,
    headless: bool = True,
    extensions: list[str] | None = None,
    iterations: int = 1,
    low_priority: bool = True,
) -> BenchmarkRunResult:
    """Runs `iterations` independent measurements and reports the median of each metric."""
    resolved = shutil.which(binary) or binary
    if not Path(resolved).exists():
        raise FileNotFoundError(f"Browser binary not found: {binary}")
    extensions = [str(Path(e).resolve()) for e in (extensions or [])]
    for ext in extensions:
        if not (Path(ext) / "manifest.json").exists():
            raise FileNotFoundError(f"No manifest.json in extension dir: {ext}")

    common_flags = [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
    ]
    if headless:
        common_flags.append("--headless=new")
    if extensions:
        common_flags.append("--load-extension=" + ",".join(extensions))

    server, port = start_local_fixture_server()
    try:
        runs = [
            _single_run(resolved, common_flags, port, idle_window_sec, workload_window_sec, low_priority)
            for _ in range(max(1, iterations))
        ]
    finally:
        server.shutdown()
        server.server_close()

    med = lambda key: statistics.median(r[key] for r in runs)  # noqa: E731
    return BenchmarkRunResult(
        label=label,
        binary=resolved,
        startup_ms=round(med("startup_ms"), 1),
        idle_cpu_percent=round(med("idle_cpu_percent"), 2),
        idle_rss_mb=round(med("idle_rss_mb"), 2),
        idle_pss_mb=round(med("idle_pss_mb"), 2),
        idle_uss_mb=round(med("idle_uss_mb"), 2),
        workload_rss_mb=round(med("workload_rss_mb"), 2),
        workload_pss_mb=round(med("workload_pss_mb"), 2),
        workload_cpu_percent=round(med("workload_cpu_percent"), 2),
        process_count_idle=int(med("process_count_idle")),
        process_count_workload=int(med("process_count_workload")),
        ntp_pss_mb=round(med("ntp_pss_mb"), 2),
        ntp_rss_mb=round(med("ntp_rss_mb"), 2),
        iterations=len(runs),
        extensions=tuple(extensions),
    )


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
    delta_ntp_pss_mb = round(oxygen.ntp_pss_mb - baseline.ntp_pss_mb, 2)
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
            "ntp_pss_mb": delta_ntp_pss_mb,
            "startup_ms": round(oxygen.startup_ms - baseline.startup_ms, 1),
            "within_20mb_budget": within_budget,
        },
    }

    json_path = out_dir / f"benchmark-{ts}.json"
    md_path = out_dir / f"benchmark-{ts}.md"
    json_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    md = f"""# Oxygen vs Helium Benchmark Report ({ts})

Median of {oxygen.iterations} run(s) per browser; headless, nice 19 / ionice idle, warm throwaway profiles.

| Metric | {baseline.label} | {oxygen.label} | Delta |
| --- | ---: | ---: | ---: |
| Startup (ms) | {baseline.startup_ms} | {oxygen.startup_ms} | {payload['delta']['startup_ms']:+.1f} |
| Idle PSS (MB) | {baseline.idle_pss_mb} | {oxygen.idle_pss_mb} | {delta_idle_pss_mb:+.2f} |
| Idle RSS (MB) | {baseline.idle_rss_mb} | {oxygen.idle_rss_mb} | {oxygen.idle_rss_mb - baseline.idle_rss_mb:+.2f} |
| Idle CPU (%) | {baseline.idle_cpu_percent} | {oxygen.idle_cpu_percent} | {delta_idle_cpu:+.2f} |
| New Tab PSS (MB) | {baseline.ntp_pss_mb} | {oxygen.ntp_pss_mb} | {delta_ntp_pss_mb:+.2f} |
| New Tab RSS (MB) | {baseline.ntp_rss_mb} | {oxygen.ntp_rss_mb} | {oxygen.ntp_rss_mb - baseline.ntp_rss_mb:+.2f} |
| 5-Tab PSS (MB) | {baseline.workload_pss_mb} | {oxygen.workload_pss_mb} | {delta_work_pss_mb:+.2f} |
| 5-Tab CPU (%) | {baseline.workload_cpu_percent} | {oxygen.workload_cpu_percent} | {oxygen.workload_cpu_percent - baseline.workload_cpu_percent:+.2f} |

**20 MB Incremental Memory Budget (idle PSS delta):** {"PASS" if within_budget else "FAIL"}
"""
    md_path.write_text(md, encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Oxygen RAM & CPU Benchmark Suite")
    parser.add_argument("--binary", help="Single browser binary to benchmark")
    parser.add_argument("--helium", help="Baseline Helium binary path")
    parser.add_argument(
        "--extension",
        action="append",
        default=[],
        help="Unpacked extension dir loaded for the Oxygen run (repeatable, e.g. extension + theme pack)",
    )
    parser.add_argument("--oxygen", help="Legacy: separate Oxygen browser binary (fork builds)")
    parser.add_argument("--iterations", type=int, default=3, help="Runs per browser (median reported)")
    parser.add_argument("--window", type=float, default=4.0, help="Sampling window in seconds")
    parser.add_argument("--headed", action="store_true", help="Run without --headless=new")
    parser.add_argument("--normal-priority", action="store_true", help="Do not wrap in nice/ionice")
    args = parser.parse_args()

    headless = not args.headed
    low = not args.normal_priority
    common = dict(headless=headless, iterations=args.iterations, low_priority=low)

    if args.helium and (args.extension or args.oxygen):
        base_res = benchmark_binary("Helium", args.helium, args.window, args.window, **common)
        if args.extension:
            ox_res = benchmark_binary(
                "Helium + Oxygen", args.helium, args.window, args.window,
                extensions=args.extension, **common,
            )
        else:
            ox_res = benchmark_binary("Oxygen", args.oxygen, args.window, args.window, **common)
        json_path, md_path = write_comparison_report(base_res, ox_res)
        print(md_path.read_text(encoding="utf-8"))
        print(f"Saved JSON: {json_path}")
        return 0

    if args.binary:
        res = benchmark_binary(
            "Browser", args.binary, args.window, args.window, extensions=args.extension, **common
        )
        print(json.dumps(asdict(res), indent=2))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
