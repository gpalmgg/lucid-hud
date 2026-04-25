# Lucid HUD — Feature Ideas Catalog

A menu of features anyone forking lucid-hud can pull from. Split into two lists:

1. **Sensible upgrades** — natural extensions of the context-intelligence thread
2. **Surprise features** — weirder, more opinionated, more *inhabited*

Each item has a short pitch and a rough complexity signal. `[shipped]` means it exists in the codebase already.

---

## List 1 — Sensible upgrades

### Cost / efficiency

1. **Burn rate** — show `$/hr` next to total cost, with a tiny ↑↓ arrow vs your rolling average. `[shipped]`
2. **Cache savings** — display `saved $X` next to the cache ratio so green means something concrete. *Medium.*
3. **Project cost ledger** — track lifetime spend per `cwd`, surface "this project: $42 total". *Medium — needs the shared ledger.*
4. **Forecast hint** — "at this rate, weekly limit hits in 1d 4h" when the long usage bar is climbing fast. *Medium.*
5. **Cost-per-message** — micro-stat showing avg $/turn this session. *Easy.*

### Context intelligence

6. **Reclaimable tokens** — `[shipped]` The surface was added in the original fork but off by default; now on by default with a lower threshold.
7. **Context breakdown sparkline** — system / files / tools / responses as four colored sub-segments inside the bar. *Hard — needs finer transcript accounting.*
8. **Top context hogs** — opt-in second line: "🐘 file.ts 42k │ tool_results 28k". *Medium.*
9. **Turns-since-last-compact** — small number, helps decide when /compact would actually help. *Easy once ledger exists.*
10. **Token velocity** — `+3.2k/min` indicator so you see when context is spiking. *Easy once ledger exists.*

### Activity / signal

11. **In-flight tool elapsed time** — `◐ Bash 0:47` instead of just the count, warn color over 30s. *Medium.*
12. **TodoWrite current item** — show the active todo right in the HUD. *Easy.*
13. **Subagent live status** — when an Agent is running, surface its description + elapsed time. *Medium.*
14. **Tool error rate** — small `!2` badge if 2+ recent tool calls failed. *Easy.*

### Surface / config

15. **Themes** — solarized / monochrome / cyberpunk / terminal-classic via `/lucid-hud:configure`. *Medium.*
16. **Per-project config** — `.lucid-hud.json` in cwd overrides global (e.g. always show cost in client work). *Medium.*
17. **Compact one-line mode** — `[shipped]` toggle `lineLayout: "compact"` collapses everything to a single dense line for small terminals.
18. **Click-to-copy session name** — OSC 8 hyperlink in supporting terminals. *Easy.*

---

## List 2 — Surprise features

### Cross-session intelligence (the real unlock)

1. **Lifetime token ledger** — JSONL at `~/.claude/plugins/lucid-hud/ledger/` recording each session's cost/tokens/duration. Once this DB exists, many follow-ups become trivial. *[Partial — foundation shipped as session ledger for compact tracking; extend to full lifetime.]*
2. **"You usually compact around here"** — `[shipped]` Learns your personal compact threshold from history and nudges when you're past it.
3. **Project context fingerprint** — after a few sessions in a project, learns the "shape" of normal context and flags anomalous sessions. *Hard.*

### Ambient personality

4. **HUD pet** — `[shipped]` A single ASCII creature at line-end whose state mirrors session health: sleepy when idle, alert when tooling, sick when context bloated, happy after a compact.
5. **Procedural session sigil** — a 3-character glyph generated deterministically from session id, giving each session a unique mark. *Easy.*
6. **Mood-ring color drift** — subtle background tint of the bar shifts hue across the session as cost × cache ratio evolves. *Medium.*
7. **Phase-of-day glyph** — sun/dusk/moon character matching your local hour. *Easy.*

### Diagnostic-as-art

8. **Braille token graph** — last 60 turns of token usage rendered in a single 10-char braille sparkline. *Medium.*
9. **Tool heatmap row** — opt-in line showing last 60 turns as colored cells where intensity = tool count and hue = tool category. *Medium.*
10. **Generative pattern resetting on /compact** — a decorative character that evolves cell-by-cell each turn; compact resets it, making sessions feel like things with lifespans. *Medium.*

### Behavioral nudges

11. **Pomodoro detector** — if continuous session duration >25min with no `/clear`, glyph turns to a quiet 🍅. *Easy.*
12. **"Stuck" detector** — `[shipped]` If the same file has been Edit-ed 3+ times in a row, HUD whispers `↻×3 file.ts`.
13. **First-message-after-long-break** — when last session was >12h ago, a small `welcome back` glyph appears for the first 2 minutes. *Easy once ledger exists.*
14. **Cost-guilt mode (toggleable)** — translates session cost into something tangible: `$3.40 ≈ 1 burrito`. *Easy.*

### Latent platform state

15. **Skills-invoked count this session** — how many skills have actually loaded. *Medium — needs transcript marker parsing.*
16. **Hooks-fired count** — small counter showing hooks are actually firing. *Medium.*
17. **Active CLAUDE.md path** — `[shipped]` Shows which CLAUDE.md scope is currently load-bearing (user / project / both).
18. **Memory writes this session** — counter of memory files created/updated this session. *Easy.*

### Esoteric / signature

19. **I Ching hexagram derived from session entropy** — six-line glyph generated from session state hash. Genuinely useless, completely yours. *Easy.*
20. **Daemon** — `[shipped]` A session-scoped spirit-animal name, deterministic from session id, persisted across resumes. After a few weeks you start recognizing daemons.

---

## Implementation notes

- **Foundation**: `src/session-ledger.ts` provides per-session state tracking (last-seen context%, file edit history) and an append-only JSONL ledger of compact events. It's the shared dependency for features #2, #9, #10, #11, #13, #18 across the lists.
- **Display toggles**: every feature gates behind a `display.showFooBar` boolean in config, with most defaulting to `false` for backward compatibility.
- **Render surfaces**: identity line for inline whispers, project line for identity-type badges (daemon), environment line for system state (CLAUDE.md scopes).
- **Performance**: the statusline runs every ~300ms. Any feature touching disk must use the transcript-cache or a bounded read of a small state file. No network calls.

---

## Credit

Many of the "boring" items build on the original [`claude-hud`](https://github.com/jarrodwatts/claude-hud) scaffolding by Jarrod Watts. The fork-specific direction (context intelligence → session intelligence → ambient personality) is the lucid-hud spin.
