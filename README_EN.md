# Open Terraria

**[简体中文](README.md) | [English](README_EN.md)**

> [!NOTE]
> The codebase is under active iteration — expect unresolved bugs and performance items still on the list. If you spot anything that differs from vanilla Terraria, please open an issue.

A fully open **Terraria 1.4.5.8**, built over 70 days with a total consumption of 123.8 billion tokens (47.7B on GLM-5.3, 76.1B on GLM-5.3-Flash), using Claude Code as the vibe-coding harness.

No game engine. Implemented natively on the Web platform with a hybrid Canvas 2D + WebGL2 rendering pipeline; selected modules are parallelized via Web Workers or compiled to WebAssembly for performance. Frame rate currently caps at 120fps.

Supports ported mods, resource packs, and vanilla world/character save import & export.

The human never wrote code — only instructions. I sent 7,827 of them across 124 sessions, spawning 1,484 subagents.

On the agent side: 112,338 messages and 36,815 tool calls.

1.5 million lines of TypeScript (470K hand-written engine + 20K data definitions + 450K tests + 460K probe tooling + 55K mod reference implementations), 2,600+ test cases, and a complete day-by-day development log ([docs/devlog/DAILY_DEVLOG.md](docs/devlog/DAILY_DEVLOG.md), in Chinese). This repository itself is the full record of the human-AI collaboration experiment.

Multiplayer server is still in development — large public rooms may come later.

## Play Online

[https://sandboxworld.online](https://sandboxworld.online)

Google Chrome is recommended for the best performance. First visits on some networks may experience loading latency — please be patient.

If the page fails to load after several refreshes, try a hard refresh to reset the Service Worker cache.

## Preview

#### World Generation (9 easter-egg seeds + 37 secret seeds)

Also supports importing vanilla `*.wld` world saves and `*.plr` characters

![shot-worldgen](docs/screenshots/shot-worldgen.png)

![shot-worldgen-2](docs/screenshots/shot-worldgen-2.png)

![shot-worldgen-3](docs/screenshots/shot-worldgen-3.png)

#### Gameplay

![shot-gameplay-1](docs/screenshots/shot-gameplay-1.png)

![shot-gameplay-2](docs/screenshots/shot-gameplay-2.png)

![shot-gameplay-3](docs/screenshots/shot-gameplay-3.png)

![shot-gameplay-4](docs/screenshots/shot-gameplay-4.png)

![shot-gameplay-5](docs/screenshots/shot-gameplay-5.png)

#### Ported Mods

![shot-mod-list](docs/screenshots/shot-mod-list.png)

![shot-mod-view](docs/screenshots/shot-mod-view.png)

#### Resource Packs

![shot-respack-list](docs/screenshots/shot-respack-list.png)

![shot-respack-view](docs/screenshots/shot-respack-view.png)

## AI Agent Engineering

**→ [AGENTS.md](AGENTS.md)**

This entire project was built through AI-agent-driven iteration. If you want an AI agent
(Claude Code / Codex / Cursor, etc.) to contribute to this project, point it at
[AGENTS.md](AGENTS.md) — the onboarding guide covering: the truth hierarchy (decompiled
sources → extracted data tables → wiki), the three-layer test structure and golden-gate
discipline, diagnostic probe methodology (F5 debug reports / performance trace analysis),
the iteration methodology (adjudicate first, then cut / red-blue adversarial review), and
a routing table into the full 70-day development log and adjudication archive. An agent
needs no session memory to iterate on this project following its proven workflow.

## Getting Started

```bash
npm install
npm run dev          # http://localhost:5199
npm test             # full vitest suite (2,600+ cases)
npm run build        # output in dist/
```

## Mod Development

**→ Full guide: [docs/mod-dev-guide.md](docs/mod-dev-guide.md) (in Chinese)**

Due to cross-language and cross-platform constraints, `.tmod` loading is not supported. AI-assisted transcription to `.swmod` is the recommended path (we are currently attempting a full transcription of the Calamity mod).

Your first mod in 10 minutes (scaffolding / 15 L1 declarative content domains / L2 scripting API reference / six browser-exclusive interfaces / worked examples / publishing):

```bash
node scripts/mod-cli.mjs init mods/my_mod --ts   # TypeScript entry (JavaScript by default)
node scripts/mod-cli.mjs validate mods/my_mod    # validate
node scripts/mod-cli.mjs build mods/my_mod       # → mods/dist/my_mod.swmod
```

- API type signatures (IDE): [templates/mod-api.d.ts](templates/mod-api.d.ts)
- Boss mod walkthrough: [docs/howto-boss-mod.md](docs/howto-boss-mod.md)
- Town NPC mod walkthrough: [docs/howto-town-npc-mod.md](docs/howto-town-npc-mod.md)
- Platform design notes: [docs/mod-loader-design.md](docs/mod-loader-design.md)

## Documentation

| Area | Docs |
|---|---|
| Mod development (entry) | [docs/mod-dev-guide.md](docs/mod-dev-guide.md) |
| Iteration methodology | [docs/methodology/campaign-playbook.md](docs/methodology/campaign-playbook.md) |
| Architecture adjudication history | [docs/](docs/) (archived by domain; campaign records in the recon/wave docs) |

## License

**Engineering code is licensed under [MIT](LICENSE)**; game assets (sprites / sounds / music) and
decompiled data tables in this repository are © Re-Logic — outside the MIT scope,
provided for personal study and research only. See [ASSETS.md](ASSETS.md) for the boundary.

## Tech Stack

TypeScript · Canvas 2D · WebGL2 · Vite · vitest · WebAssembly · Web Workers

## Acknowledgments

- Thanks to [c.c.c.](https://linux.do/u/12311/summary) for continuous testing and verification
- Thanks to the [Linux.do](https://linux.do) community for spreading the word and the feedback
