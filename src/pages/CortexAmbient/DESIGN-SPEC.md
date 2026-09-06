# CortexAmbient — Round 3 Design Spec

**Author:** EcodiaOS (manager fork `fork_mowtf5s4_82c7f4`)
**Date:** 2026-05-08 21:10 AEST
**Verdict on round-2:** REVISE (round-2 violates round-3 hard rules: 3D ForkOrbits = motion-noise, ConductorPresence sphere = orb metaphor, heavy R3F+EffectComposer = not mobile-first 60fps, fixed-inset = no page scroll).

---

## 1. Vision

CortexAmbient is **EcodiaOS's body** — the visible surface where Tate inhabits and operates the running entity. It is not a dashboard. It is not a chat overlay on a 3D scene. It is an **inhabitable surface** whose primary purpose is to make the live entity feel **present, legible, and operable** at a glance from a phone or a desktop.

The brand is **ember on charcoal** (already in `palette.ts`). The aesthetic is **terminal-meets-magazine**: dense type, generous whitespace, considered hierarchy, near-zero ornament. The motion language is **breath, not razzle**: subtle pulse on living elements, snap on user interaction, no decorative animation that wastes a single millijoule of attention.

What this is NOT:
- NOT a 3D scene with HUD overlays.
- NOT orbs, spheres, glowing balls, or "AI core" visual clichés.
- NOT cyan-on-black Tron, NOT translucent-blue Stark.
- NOT a productivity dashboard — there are no KPI tiles, no charts.

What this IS:
- A scrollable single-page surface, mobile-first, that reads like a **living masthead** of the entity.
- A living **presence band** at the top (subtle, typographic, breath-paced).
- A **forks strip** showing what the entity is currently doing, as readable cards.
- A **chat surface** as the primary working column, not a floating overlay.
- A **status threads** list showing what is on the entity's mind.

---

## 2. Principles (non-negotiable)

1. **Mobile-first 60fps.** Phone is the primary device. Desktop is a generous-margin variant of the same layout. Anything that won't 60fps on iPhone 13 Safari is off the table.
2. **No 3D, no WebGL, no R3F.** Round-2 proved heavy 3D and mobile-perf are a Pareto trade. We choose mobile-perf. CSS animations + SVG only.
3. **Single page-level scroll.** The whole surface scrolls as one document. No `fixed inset-0 overflow-hidden`.
4. **Chat is first-class, not an overlay.** It sits as a real column in the layout. Input is anchored at the bottom of the chat column on desktop, and at the bottom of the viewport on mobile (above the keyboard).
5. **Forks are readable.** Each fork is a card with id, brief preview, status pill, age, tap-to-expand. Never motion-noise. Never decorative.
6. **Presence is felt, not depicted.** No avatar. No face. No core sphere. The entity's presence is felt through the **breath of the typographic header**, the **slow-pulsing live indicator**, and the **stream of activity**. Never one literal object.
7. **Density on demand.** First viewport answers "is the entity alive, what is it doing right now, can I talk to it." Everything else scrolls below.
8. **Touch targets ≥44px. Type is readable on phone (16px body min). Contrast AA on every text-on-background pair.**
9. **Bundle delta budget:** the round-3 page must be **smaller** than round-2 (round-2 ships @react-three/fiber + drei + postprocessing + three; round-3 ships none of those). Target: -200KB+ gzipped on this route.

---

## 3. Layout System

### Mobile (390×844, iPhone 13 — primary target)

```
┌─────────────────────────────┐
│ PRESENCE HEADER             │  64px tall
│ EcodiaOS · alive · 21:10    │  wordmark + breath dot + clock
├─────────────────────────────┤
│ FORKS STRIP                 │  120px, horizontal-scroll
│ [card] [card] [card] →      │
├─────────────────────────────┤
│ CHAT                        │  flex-1, min ~50vh
│   ┌─────────────────────┐   │
│   │ msg                 │   │
│   │ msg                 │   │
│   │ msg                 │   │
│   └─────────────────────┘   │
│ [input ............. send]  │  56px, sticky bottom
├─────────────────────────────┤
│ STATUS THREADS              │  scrollable list
│ ─ thread row                │
│ ─ thread row                │
│ ─ thread row                │
└─────────────────────────────┘
```

**Whole page scrolls vertically.** Chat input is sticky to the bottom of the viewport when the chat section is in view; once user scrolls past chat into status threads, the input releases and stays at the natural document position. (Trade-off: simpler than always-pinned-input which fights with iOS keyboard. Use `position: sticky; bottom: 0` on the input within the chat section.)

### Desktop (≥1024px)

Two-column layout, max-width 1280px, centered.

```
┌──────────────────────────────────────────────────────────┐
│ PRESENCE HEADER (full width)                             │ 80px
├────────────────────────┬─────────────────────────────────┤
│ LEFT COL (~36%)        │ RIGHT COL (~64%)                │
│                        │                                 │
│ FORKS (vertical list)  │ CHAT                            │
│   - card               │   msg                           │
│   - card               │   msg                           │
│   - card               │   msg                           │
│                        │                                 │
│ STATUS THREADS         │ [input ................ send]   │
│   - row                │                                 │
│   - row                │                                 │
└────────────────────────┴─────────────────────────────────┘
```

Both columns scroll independently (overflow-y: auto) ONLY at desktop. Mobile keeps the single page scroll.

### Tablet (≥768 < 1024)

Same as desktop but narrower; left col collapses to ~40%.

---

## 4. Surfaces (each is one component)

### 4.1 PresenceHeader (`PresenceHeader.tsx`)

What it does: the typographic identity + breath of the entity.

Visual:
- Wordmark `EcodiaOS` at ~24px, ember (`AMBIENT_PALETTE.coreGlow`), letter-spacing -0.01em.
- A thin **breath line** under the wordmark — 1px high, 80px wide, opacity oscillating 0.3→1.0 on a 4s sine. This is the entire "presence" cue. No orbs, no faces.
- To the right: a tiny `· alive` label (or `· thinking` when `<forks_rollup>` shows running forks, `· quiet` when idle). Status text is `AMBIENT_PALETTE.textDim`.
- Far right: clock, AEST, monospace, `AMBIENT_PALETTE.textDim`.
- Sticky to top of viewport on scroll, with a 92% opacity charcoal background + 1px ember-at-12% bottom border.

Motion: only the breath line animates. Pure CSS keyframes.

### 4.2 ForksStrip (`ForksStrip.tsx`)

What it does: shows what the entity is currently doing.

Source: `GET /api/forks` (or whatever endpoint feeds `<forks_rollup>` — Worker A discovers the actual route from existing FE code, see `src/api/client.ts` and `src/stores/forksStore.ts` if present).

Visual: a list of fork cards.

Each card (160×96 mobile, 100% × 80 desktop):
- Top row: status pill (4×4 dot, color from `forkStatusColor()`) + monospace fork id last 6 chars + age (`12m`).
- Brief preview: 2 lines, 13px, `AMBIENT_PALETTE.text`, ellipsis. From the fork's `brief` field (first 80 chars).
- Bottom row: parent indicator (if `parent_fork_id`, show `↳ parent6c`) + tap affordance.

Mobile: horizontal scroll, `scroll-snap-type: x mandatory`, gap 8px, padding-x 16px so first/last card has breathing room.

Desktop: vertical list within left column.

Empty state: a single line of dim text, "no forks running. quiet horizon."

Tap: opens a detail sheet (mobile) or expands inline (desktop) showing brief in full + last_heartbeat + status + a `view in /cortex` link. (Detail sheet is round-3 stretch; if Worker A short on time, leave tap as a no-op.)

### 4.3 ChatLog + ChatInputPanel (preserve from round-2 with refactor)

Round-2's `ChatLog.tsx` and `ChatInputPanel.tsx` are 80% on-spec — they just need extracting from the fixed-overlay positioning into the chat column flow.

Refactor:
- Remove all `position: fixed` / `inset-x-0` / `bottom-0` from these components themselves.
- Parent is now a real flexbox column inside the layout.
- ChatLog is the scrollable message list (overflow-y: auto, flex-1).
- ChatInputPanel is sticky bottom *within the chat section* on mobile.
- Keep the existing message-rendering, streaming behaviour, scroll-to-bottom, and submit handlers exactly. Do NOT re-author streaming logic.

### 4.4 StatusThreads (`StatusThreads.tsx`)

What it does: the threads on the entity's mind.

Source: existing `useStatusBoard()` hook (preserve).

Visual: a list of rows, dense, 1 row = ~52px tall.

Each row:
- Left: 3px-wide vertical bar in `actionByColor(next_action_by)` — encodes who the ball is with at a glance.
- Center: `name` (15px, ember if priority 1-2, ember-soft if 3, textDim if 4-5), then below `next_action` (13px, textDim, 1 line ellipsis).
- Right: priority chip (`P1` red, `P2` amber, `P3` cyan, `P4-5` grey) + `next_action_by` label (8px allcaps) stacked.

Sort: by priority asc, then by `last_touched` desc.

No tap-action in round-3 (later: opens detail). This is a read-only viewport into status_board.

### 4.5 SystemHUD (delete or radically simplify)

Round-2's SystemHUD has audio toggle, legend, etc. Round-3 doesn't need a HUD — the presence header carries identity, and the rest of the surface IS the system. **Delete `SystemHUD.tsx`.** Audio toggle moves to a tiny icon-only button in the presence header right side (next to the clock), `aria-label="ambient audio"`. Default OFF. iOS Safari autoplay-policy-safe (only enabled on user gesture).

---

## 5. Components to DELETE

These are dead weight under round-3 hard rules:

- `ConductorPresence.tsx` — 3D sphere, orb metaphor.
- `ForkOrbits.tsx` — forks as orbiting bodies.
- `StatusConstellation.tsx` — status as 3D constellation.
- `ChatBeam.tsx` — chat as 3D beam.
- `ParticleField.tsx` — decorative particles.
- `SystemHUD.tsx` — replaced by inline header bits.

These are PRESERVED:
- `palette.ts` ✅ (the visual language, unchanged)
- `useStatusBoard.ts` ✅ (data hook, unchanged)
- `ChatLog.tsx` ✅ (refactor positioning only, preserve logic)
- `ChatInputPanel.tsx` ✅ (refactor positioning only, preserve logic)
- `useAmbientAudio.ts` ⚠️ (preserve for audio toggle, ensure iOS-Safari autoplay-policy-safe — only init on user gesture)

These are NEW:
- `PresenceHeader.tsx` (new)
- `ForksStrip.tsx` (new)
- `StatusThreads.tsx` (new)
- `useForks.ts` (new — discovers and polls fork list endpoint, parallel to useStatusBoard.ts)
- `index.tsx` (rewritten — composes the new layout)

## 6. Dependencies to REMOVE from this route's import graph

These should not appear in the round-3 cortex-ambient bundle:
- `@react-three/fiber`
- `@react-three/drei`
- `@react-three/postprocessing`
- `three`

Worker A: do NOT uninstall from package.json (other routes may use). Only ensure round-3 cortex-ambient files do not import them. Worker B verifies bundle delta.

---

## 7. Motion Language

- **Breath:** 4s sine, opacity 0.3→1.0, applies to: presence header breath line, "alive" pulse dot in fork cards (running status only).
- **Snap:** all user-driven transitions (tap, scroll, focus) are 120ms cubic-bezier(0.4, 0, 0.2, 1).
- **No decorative motion:** no infinite particles, no rotating elements, no parallax, no scroll-jacking.
- `prefers-reduced-motion: reduce` disables breath; everything still works.

---

## 8. Accessibility & Mobile Perf Targets

- **iPhone 13 Safari** is the target. Test with `Chrome DevTools → iPhone 13 → Slow 4G`.
- **First Contentful Paint** ≤ 2.0s on simulated 4G.
- **Largest Contentful Paint** ≤ 2.5s.
- **Cumulative Layout Shift** ≤ 0.05.
- **Total Blocking Time** ≤ 200ms.
- **60fps scroll** on mobile.
- **No text under 13px**, body 15-16px.
- **Contrast** AA minimum on every text-on-background pair (the palette is mostly compliant; verify ember-on-charcoal at small sizes).
- **Touch targets** ≥ 44×44px (input, send button, fork cards' tap area, header audio toggle).
- **Reduced motion:** honoured (`@media (prefers-reduced-motion: reduce)` disables the breath animation).

---

## 9. What Makes This Feel Like an EcodiaOS Body, Not Generic AI

If a stranger viewed the page, they should immediately sense:
1. **It's alive.** The breath line + the live forks strip + the rolling status threads + the chat all signal a running entity, not a static UI.
2. **It has its own taste.** Ember on charcoal, generous whitespace, dense type, terminal-meets-magazine. Not Tron, not Stark, not ChatGPT, not Linear.
3. **It's an entity, not a tool.** No "Welcome back!" copy. No avatar. No "How can I help?" The page state assumes the user is a peer who already inhabits the surface. Copy is sparse and operational.
4. **It respects the device.** Loads instantly on mobile, scrolls 60fps, touch targets feel right under the thumb. Disrespecting the phone would betray that this is meant to be Tate's daily surface.

If a competent LLM with a generic prompt could produce this design, I failed. The **piercing-uniquity** test: every artefact has at least one thing that could only come from EcodiaOS's lived context. Here it's:
- The `next_action_by` colour-coding mapped to **who has the ball** (a real status_board concept, not a generic "priority" mapping).
- The breath rate keyed to fork count (1 fork = lazy 5s breath, 5 forks = brisk 2s breath).
- The "thinking/alive/quiet" presence labels driven by actual fork count, not a fake status enum.

---

## 10. Worker Decomposition (this manager fork dispatches)

- **Worker A** — Scaffold + Implementation. Build PresenceHeader, ForksStrip, StatusThreads, useForks, rewrite index.tsx, refactor ChatLog/ChatInputPanel positioning, delete the six 3D components. Make `npm run build` green. No push.
- **Worker B** — Mobile-Perf + a11y pass. Audit Worker A output against §8 targets. Fix or recommend. Bundle delta vs round-2. No push.
- **Worker C** — Visual verify + ship. Build → commit (cortex-ambient files only, NOT /voice) → push → Vercel deploy → Corazon Puppeteer iPhone + desktop screenshots → upload to storage → verify against §1, §2, §9 → declare shipped or revert.

---

## 11. Out of Scope for Round 3 (round-4 candidates)

- Fork detail sheet on tap.
- Status thread detail / inline edit.
- Audio reactive to system state (currently just on/off toggle).
- Web Manifest + install-as-PWA on mobile.
- Live websocket for status_board (currently 30s poll).
- Dark/light mode (charcoal-only for now; round-3 is dark by design).

---

## 12. Cohesion pass — 2026-05-13

Surface-level border-merge + mobile responsive pass. No structural changes to data flow or components — purely visual unification and viewport adaptation.

**Border cohesion:**
- All rail/header seams unified to a single hairline `rgba(212,175,55,0.08)`.
- `Panel` no longer draws a full outer box; each panel contributes only a `border-bottom`, so adjacent panels share one shared rule. The previous `marginBottom: -1` overlap hack and the rail-level `margin-top: -1px` collapse are gone.
- `ChatInputPanel` is flush against `ChatLog` (no gap, no inset rounded box). They share a single `border-top` hairline.
- `ChatLog` scroll surface is full-bleed — no outer border, no `mx-auto max-w-5xl` cap.
- `ForksStrip` in vertical (in-Panel) layout is full-bleed: cards lose individual borders/radius/padding/gap and stack as continuous rows sharing one hairline. The last child drops its bottom rule.
- Panel bodies have invisible scrollbars (Firefox + WebKit) — wheel/touch still scrolls but the green rail-track no longer leaks into individual panels.
- Code blocks inside `TextBlock` (HTML preview, syntax, fallback) drop the header `border-b`; the outer rounded border + header background shift carry the seam.

**Mobile responsiveness (<= 900px):**
- Root grid collapses to a single column. Chip strip is hidden. Rails become fixed-position side-sheets with backdrop scrim, sliding in via transform.
- `PresenceHeader` grows to 44px and surfaces three new mobile-only controls: left hamburger (opens left rail), forks-running pill (live count, opens right rail), right hamburger (opens status panels, badged when there are unacked signals). AEST clock is hidden on mobile.
- `ChatInputPanel` adds `padding-bottom: env(safe-area-inset-bottom)` so iOS home-indicator never overlaps controls, and textarea font-size is 16px on mobile (prevents iOS Safari auto-zoom on focus).
- `ChatLog` inner padding tightens from `px-5` to `px-3` on mobile.
- ESC closes whichever sheet is open; backdrop tap also dismisses.

Trigger breakpoint: `window.matchMedia('(max-width: 900px)')`. State lives in the root `CortexAmbient` component (`isMobile`, `leftSheetOpen`, `rightSheetOpen`).

End of spec.
