# Attribution and Third-Party Licenses

Oxygen is an independent, community-driven customization layer that runs as a
Manifest V3 extension (plus theme packs) on top of the Helium browser, which is
built on Chromium. Oxygen does not ship or modify browser binaries.

Earlier Oxygen releases were a source fork of Helium; that code is preserved on
branch `archive/chromium-fork` (tag `v0.1-fork`).

## Upstream Projects

- **Helium Browser** (`imputnet/helium`, `imputnet/helium-linux`)
  - License: GPL-3.0
  - Repository: https://github.com/imputnet/helium
  - Role: The browser Oxygen runs on (privacy defaults, bundled uBlock Origin, UI).
    The archived fork also reused Helium patches and build infrastructure.

- **ungoogled-chromium**
  - License: BSD 3-Clause
  - Repository: https://github.com/ungoogled-software/ungoogled-chromium
  - Role: Degoogling patches and build utilities inherited by Helium.

- **The Chromium Project**
  - License: BSD-style / multi-license (see Chromium `LICENSE`)
  - Role: Underlying browser engine, Blink, V8, extension platform (MV3).

## Oxygen Original Components

All original Oxygen Core, Oxygen Control Center, Module SDK, the Oxygen
extension, theme packs, branding assets, and scripts are licensed under GPL-3.0
unless explicitly marked otherwise.
