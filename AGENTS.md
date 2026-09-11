# Onmyoji Yuhun UI Map

`ui/` is a Vue 3 / Pinia workbench for analysing a player's yuhun snapshot,
configuring team targets, generating game filter codes, and comparing saved
plans. The application entry is `ui/src/main.ts`; route definitions
live in `ui/src/router.ts`; state, persistence, worker calls, and UI commands
live in `ui/src/store.ts`.

## Workflow and Route Guards

The left navigation is an ordered workflow, rendered by `ui/src/App.vue`:

1. `#/snapshot` - Data snapshot
2. `#/targets` - Targets and strategies
3. `#/analysis` - Analysis results
4. `#/codes` - Dual codes and preview
5. `#/compare` - Plan comparison and management

`/targets` and `/analysis` redirect to `/snapshot` when no snapshot has been
loaded. `/codes` redirects to `/analysis` until analysis or a generated plan
exists. `/policy` is a legacy redirect to `#/targets#retention`; it does not
currently render a separate policy editor.
`/reconcile` redirects to `/compare`; the old reconciliation view is removed.
Comparison requires a snapshot, but the plan library can be managed without one.

## Shared Shell and Global UI

`ui/src/App.vue` provides the following UI outside individual routes:

- The top bar shows the product name and imported-item count. Its commands
  import/export scene data, open Settings, and clear the in-memory plus local
  session after confirmation. Session saving/restoration remains automatic;
  project-summary and private-handoff controls are not shown in the top bar.
- Errors and notices from the store are displayed globally and can be closed.
- The bell immediately before Settings opens the notification center and shows
  unread release counts. `ui/src/notifications.ts` owns the newest-first release
  list; add a new stable `version` and its changes for each notification release.
  Read versions and onboarding progress persist independently in localStorage.
- First visits show the test warning, then the data-sharing confirmation.
  The warning requires five seconds of visible reading; hidden tabs pause the
  timer, and backdrop/Escape cannot bypass either required confirmation. The
  background is inert and modal focus stays inside the notification dialog.
  Sharing defaults to checked only when no prior preference exists; changing a
  draft does not grant consent until Confirm. Existing opt-outs are preserved.
  Completing onboarding establishes the current release as the initial baseline.
  Returning visitors see unread release notes once, and the bell retains access
  to read releases and the test warning. Session clearing preserves these flags.
- Settings has four sections:
  - **Device:** browser/device capabilities and a CPU/memory/WebGPU benchmark.
  - **Performance records:** the latest 20 timing, workload, algorithm,
    environment, benchmark, comparison, and per-target records. Older local
    histories are trimmed on load. Import/export/clear controls are hidden.
  - **Data collection:** independent local consent switches for team targets
    and performance metrics. Each inherits legacy consent until changed.
  - **ID settings:** decode a pasted game yuhun code and persist its 16-byte
    user ID in localStorage. Only the ID is saved; changing it invalidates the
    generated plan while preserving analysis. Encoding sends this ID via the
    existing API and verifies it in the response and codec round trip.

Local session/project exports are account-derived private files and must not be
committed. The snapshot itself is processed in the browser. Remote requests are
limited to the public asset/scene releases, codec endpoints, and the optional
`/collect` telemetry endpoint after the user grants consent.

## Route UI

### 1. Data Snapshot (`ui/src/views/snapshot.vue`)

- Imports or replaces an OnmyojiHub / yyx JSON snapshot by file picker or drag
  and drop. The view then shows its SHA-256 prefix.
- Displays inventory totals: total items, six-star items, unlevelled six-star
  items, locked items, historical discard items, and initial four-substat
  items.
- Shows a level-distribution bar chart and initial-substat-count bars.
- Lists paginated inventory rows with suit-name search and level filtering;
  yuhun IDs are intentionally not displayed. The suit column uses the
  published yuhun icon when available (including legacy-name aliases).
- Main and sub stats are rendered with Chinese labels and their displayed
  values, such as `生命 +2052` or `暴击 +5.88%`. Boss yuhun intrinsic stats
  are shown alongside the main stat. Stat names use a fixed column and values
  use a compact adjacent column so each row aligns without stretching across
  the full cell.

### 2. Targets and Strategies (`ui/src/views/targets.vue`)

This is the main configuration surface.

#### Team Target Library

- Loads the published three-level scene catalog and official targets, then
  merges local custom catalog nodes and scene overrides.
- The left tree expands gameplay domains and categories, selects all/some/none
  scenes at each level, exposes a scene picker, imports lineups, and opens the
  catalog manager. A fresh view selects every scene and uses smart calculation
  with automatic difficulty fallback. Scene selection (including none), mode,
  and difficulty preferences persist across navigation and session restore.
- The result pane groups imported targets by scene. It supports per-target and
  bulk enablement, filtering by enablement/calculation state, per-scene yuhun
  mutual exclusion, and target preview/detail/delete actions.
- **Manual selection** calculates enabled targets. **Smart selection** starts
  forced targets first, otherwise tries targets from highest difficulty and can
  step down through the selected number of difficulties (or automatically
  until exhausted). A calculation can be paused and resumed; completed reports,
  per-target progress, and the original manual/smart options are retained in
  the private browser session. After a refresh or browser restart, an
  interrupted run restores as paused and continues only uncompleted targets.
  Recalculation requires confirmation before clearing calculation-derived
  results and keeps the selected scenes and targets. The toolbar reset stops
  the active calculation, clears its results, and restores all scenes, smart
  mode, and automatic difficulty fallback. It retains the snapshot, targets,
  and strategies. Loading
  published targets must merge with this local state rather than invalidate it.
- Expanded calculation results show each configured shikigami's selected suit,
  score, target-score pass/fail state, panel attributes, pieces, and failure
  reason. Calculation errors can be copied.

#### Add / Inspect / Edit a Team Target

- The import dialog provides two entry modes, both with cascade selection of
  domain, category, scene, optional name, and either difficulty fallback or
  forced calculation.
- **Team-code import:** accepts `#TA#` text, clipboard content, pasted QR
  screenshots, or a selected QR image. It decodes the code, derives a team
  label and scene when possible, validates the selected scene, and asks before
  overriding an identified scene or assigning a previously unassociated game
  scene ID.
- **Manual setup:** uses `ManualTargetEditor` to create up to six shikigami
  targets and save them as an enabled local lineup.
- The detail dialog reads a target's editable setup and supports view/edit.
  Published targets are read-only; saving an edit creates a local copy. Local
  targets can be deleted after a confirmation that may be suppressed for the
  current day.

#### Manual Target Editor (`ui/src/components/ManualTargetEditor.vue`)

- Selects, replaces, or removes up to six shikigami. The picker supports name
  search and rarity filters.
- Configures whether a shikigami participates in yuhun calculation; disabled
  members remain in the team but have no yuhun requirement.
- Selects 4-piece/2-piece suit combinations or scattered pieces. The suit
  picker supports category/name filtering, prevents duplicate/over-capacity
  suit selections, and includes two-piece-effect options.
- Sets an effect metric, optional target score, and one or more allowed main
  stats for positions 2/4/6. Changing the metric applies a starting main-stat
  preset without preventing later edits.
- Offers advanced constraints: highest stat, extra attack/crit attributes,
  arbitrary panel-stat min/max limits, exclusion of yuhun occupied by other
  enabled teams, all vs. unequipped scope, six-star-only, and max-level-only.
- It also has read-only rendering for inspected/published team details.

#### Scene Catalog Manager

- Manages local custom first-level domains, second-level categories, and third-
  level scenes: add, rename, delete, and reorder by drag and drop.
- Sets a custom scene's game scene ID and whether targets within that scene
  require mutually exclusive yuhun.
- Published R2 nodes remain read-only. Deleting a custom catalog subtree warns
  about and removes its local targets; scene selection is updated accordingly.

#### Preset Rule Pools

- Displays separate discard and enhancement pools. Rules can be enabled,
  disabled in bulk, added, edited, or deleted; enabled rules contribute reasons
  to single-yuhun analysis.
- The rule editor selects suits (search/category picker), positions, main stats,
  boss-yuhun intrinsic stats, included/excluded substats, and substat-count
  conditions.
- New rules use a shared dialog with **Yuhun-code import** and **Manual setup**
  tabs, matching the team import layout. All add/import buttons open the code
  tab by default. Pool add buttons preselect that pool for manual setup;
  editing an existing rule opens its dedicated editor.
- Code import accepts text, a selected QR image, clipboard text/images, and
  pasted screenshots. Images are scanned locally; the existing codec service
  decodes the recognized code on explicit submission. Loading and failures
  appear inside the dialog. Each condition group becomes one enabled rule,
  preserving supported advanced criteria and the pool encoded in the code.

### 3. Analysis Results (`ui/src/views/analysis.vue`)

- Default yuhun disposition is discard for fresh sessions; an explicitly saved
  preference is restored.
- Chooses the conservative or normal risk tier and runs/re-runs full analysis.
  Enabled team targets and preset rules are surfaced before execution.
- Shows current six-star capacity, capacity limit/free or overflow count, and
  projected marked-discard count.
- Provides a paginated single-yuhun decision table. It supports free-text suit/
  reason search and independent multi-select filters for suit, position, star,
  level, main stat, substat, retain/discard disposition, and reason.
- Each decision shows its disposition, reason, and potential-improvement
  strategy tags such as candidate combination, embryo comparison, or
  enhancement upper bound.

### 4. Dual Codes and Preview (`ui/src/views/codes.vue`)

- The desired free-slot input means final inventory free slots, defaults to 500,
  and is capped at the greatest nonnegative multiple of 100 strictly below the
  marked-discard count (2831 -> 2800, 1799 -> 1700, 2800 -> 2700). A count of 100
  or fewer gives a zero target. Changes persist in session/project settings and
  invalidate only the generated plan. The Worker derives the required release
  from current capacity (including overflow), stops after enough whole safe
  rules, and reports whether the target was reached. Insufficient coverage does
  not imply a safety failure; the existing safety gates remain independent.
- Generation still returns one D/E pair. Multi-round experiments and safe reuse
  of E are documented in the internal research repository, not implemented as
  a multi-round execution UI. E is used to restore items from the discard pool,
  not to spend enhancement resources.
- Generates and previews the D discard and E rescue codes directly after
  analysis. The frontend sends the ID saved in Settings to the encode API;
  without a saved ID, the API resolves its default. Local matching uses an
  internal placeholder Header that is never sent to the encoder. Round-trip
  validation checks the saved/service-selected ID and all generated criteria.
- Download actions export the exact code as a PNG QR image with a quiet zone.
  Generation stays local and export still requires the copy gates. A code too
  large for one QR image reports an error and remains available for copying.
- After generation, Save Plan appears immediately before the generation button.
  It saves a named, immutable D/E pair and the verified decoded criteria to the
  private plan library. Renaming changes only the name. Pure D and empty
  generated plans are supported.
- Shows cleanup/capacity comparison metrics and side-by-side D discard / E
  rescue panels styled like the target rule pools (stacked on mobile). Each
  panel contains its code and rule rows with compact icon buttons for View rule
  and View matched yuhun, matching the target rule pools. Rule details reuse YuhunConditionEditor in a read-only dialog.
  Matched inventory opens a searchable, paginated dialog with main/sub/intrinsic
  stats, using the same Worker-side D/E preview matcher. E rules allow switching
  between new, historical, and combined discard pools. Old sessions without
  criteria prompt regeneration.
- Completed codes, preview criteria/counts, copy gates, and reconciliation state
  persist in the private local session and restore after snapshot hash
  verification without regenerating codes or calling the codec API. Generation
  waits for the local save; changing inputs still invalidates the saved plan.
  Startup and route guards share the pending restoration so refresh stays on
  the requested page instead of redirecting before data is ready.
- The code page omits the account-pool funnel, detailed gate checklist,
  inventory coverage panel, and execution-order paragraph. Validation remains
  part of generation and copy/export eligibility.
- Copying/downloading codes and exporting the mobile handoff remain disabled
  until every strict gate passes: valid snapshot/targets/policy/header, group
  limit, lossless codec round trip, account preview, Tier 0 proof, and selected
  risk-tier simulation.

### 5. Plan Comparison (`ui/src/views/compare.vue`)

- Manages named plans: save from Codes, import a D/E pair or exported JSON,
  inspect codes, rename, export, and delete after confirmation. Imports decode
  the codes through the existing API, validate kind/warnings and matching D/E
  IDs, and derive criteria from the decoded result, never from imported JSON.
- Plans live in the `plans` object store of IndexedDB version 3, independently
  of the current session/snapshot. Generation, snapshot replacement, and session
  clearing preserve the library; deletion is an explicit library action.
- Select a base and a new plan, or swap them. Both pairs execute independently
  on the current snapshot in the Worker using the maintained D-then-E matcher.
  Compare final pool disposition, including historical discard restores and
  locked items. The four exclusive categories are extra discard, extra retain,
  both discard, and both retain. The initial view shows only changed items.
- Counts cover the whole snapshot. The paginated inventory table shows before
  and after disposition, original pool/lock state, and main/sub/intrinsic stats.
  Filter by change category, suit search, or the shared inventory filter editor.
  Comparison requires no analysis and does not alter generated plans or gates.
  Results are cached by the ordered rule pair and inventory, and invalidated on
  snapshot replacement/reset. Stale asynchronous UI responses are ignored.

## Reusable Presentation Components

- `ui/src/components/EChart.vue` renders responsive canvas ECharts and disposes
  its chart/resize observer on unmount. It is used for snapshot distributions.
- `ui/src/components/ExcelColumnFilter.vue` is the analysis-table filter menu:
  searchable multi-select options with select-all, clear, and apply actions.

## UI Maintenance Boundaries

- Keep product copy concise: titles, control labels, and brief result/error
  messages. Do not add tutorial paragraphs, implementation explanations, or
  unsolicited storage/privacy notices. Add descriptive copy only when requested.
- Preserve the ordered workflow and route guards when introducing a new view.
  Add the route to `STEPS` in `ui/src/router.ts`, and keep prerequisite state
  explicit.
- Put user actions and lifecycle/persistence behavior in `ui/src/store.ts`;
  keep a view responsible for form state and rendering. Heavy calculations run
  through `ui/src/worker/client.ts`, not the main UI thread.
- Do not present R2-published catalog nodes or locked official targets as
  directly editable. User-created catalog nodes, scene-ID overrides, scene
  mutual exclusion, targets, rules, and UI state are local-session data.
- Keep private exports, handoffs, raw snapshots, codes, and account-derived
  reports out of Git. Do not change the four API routes or R2 release contract
  from this repository without coordinating with their owners.
