<div align="center">
  <img src="resources/branding/product_logo.png" alt="Oxygen Browser Logo" width="112" />
  <h1>Oxygen Browser</h1>
  <p><strong>Make Your Browser Yours.</strong> — Helium-based customizable browser (Alpha 0.1)</p>
</div>

Oxygen Browser is an independent, community-driven Chromium browser built on the [Helium](https://github.com/imputnet/helium) foundation, bringing native modular customization, a Svelte Control Center (`oxygen://settings`), and a strict performance budget.

## Alpha 0.1 Milestone Status

- **Helium Fork & Upstream Tracking**: `upstream/helium-linux` + `UPSTREAM.json` (`157.0.8103.78`)
- **Oxygen Branding & Logo**: `resources/branding/` generated from the Oxygen emblem + `patches/oxygen/core/oxygen-branding.patch`
- **Oxygen Core & SDK**: `oxygen-core/` + `sdk/` + `native/components/oxygen_core/` (`EventBus`, `ConfigEngine`, `ModuleEngine`, `PerformanceEngine`)
- **Control Center (`oxygen://settings`)**: `control-center/` (Svelte 5 + TypeScript) + `native/components/oxygen_control_center/` + `patches/oxygen/ui/oxygen-control-center-webui.patch`
- **First Native Theme Module**: `modules/core-theme-obsidian/` (**Obsidian Metallic**) + `native/components/oxygen_theme/` (`OxygenThemeColorMixer`)
- **RAM & CPU Benchmark Suite**: `benchmarks/benchmark_browser.py` (compares startup, RSS/PSS/USS memory, idle & workload CPU against Helium)
- **Upstream Sync System**: `scripts/sync_upstream.py` (fetch, dry-run, patch overlap detection, lockfile updates)

## Quick Start

```bash
# 1. Verify all Alpha 0.1 components (Oxygen Core tests, Svelte Control Center build, patch checks, benchmarks)
./scripts/oxygen.sh test

# 2. Check pinned Helium upstream status & patch overlap index
./scripts/oxygen.sh status

# 3. Preview Svelte Control Center locally in your current browser
cd control-center && npm run dev

# 4. Prepare & compile full Oxygen Chromium binary (use --low-ram on 8-16 GB RAM machines)
./scripts/oxygen.sh build --low-ram

# 5. Launch Oxygen directly to oxygen://settings
./scripts/oxygen.sh run

# 6. Benchmark Oxygen against unmodified Helium
./scripts/oxygen.sh benchmark /path/to/helium /path/to/oxygen
```

## License

Oxygen Browser original code and modifications are licensed under **GPL-3.0** (see `LICENSE` and `ATTRIBUTION.md`).
