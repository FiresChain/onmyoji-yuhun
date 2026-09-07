# Onmyoji Yuhun UI Map

`ui/` is a Vue 3 / Pinia workbench for analysing a player's yuhun snapshot,
configuring team targets, generating game filter codes, and reconciling their
in-game results. The application entry is `ui/src/main.ts`; route definitions
live in `ui/src/router.ts`; state, persistence, worker calls, and UI commands
live in `ui/src/store.ts`.

## Workflow and Route Guards

The left navigation is an ordered workflow, rendered by `ui/src/App.vue`:

1. `#/snapshot` - Data snapshot
2. `#/targets` - Targets and strategies
3. `#/analysis` - Analysis results
4. `#/codes` - Dual codes, preview, and validation
5. `#/reconcile` - In-game reconciliation

`/targets` and `/analysis` redirect to `/snapshot` when no snapshot has been
loaded. `/codes` redirects to `/analysis` until analysis or a generated plan
exists. `/policy` is a legacy redirect to `#/targets#retention`; it does not
currently render a separate policy editor.

## Shared Shell and Global UI

`ui/src/App.vue` provides the following UI outside individual routes:

- The top bar shows local-session status and imported-item count. Its commands
  restore or save the local project summary, import/export scene data, export a
  project JSON, export a private mobile handoff, open diagnostics, and clear
  the in-memory plus local session.
- Errors and notices from the store are displayed globally and can be closed.
- The diagnostics dialog has three sections:
  - **Device:** browser/device capabilities, a CPU/memory/WebGPU benchmark, and
    the anonymous-collection consent toggle.
  - **Performance records:** locally kept timing, workload, algorithm,
    environment, benchmark, comparison, and per-target details. Records can
    be exported or cleared.
  - **Error information:** formatted reports for unsupported team calculations.

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
  catalog manager.
- The result pane groups imported targets by scene. It supports per-target and
  bulk enablement, filtering by enablement/calculation state, per-scene yuhun
  mutual exclusion, and target preview/detail/delete actions.
- **Manual selection** calculates enabled targets. **Smart selection** starts
  forced targets first, otherwise tries targets from highest difficulty and can
  step down through the selected number of difficulties (or automatically
  until exhausted). A calculation can be paused and resumed; the UI shows
  overall and per-target progress.
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
- A yuhun filter code can be decoded into one preset rule per condition group,
  preserving supported advanced criteria.

### 3. Analysis Results (`ui/src/views/analysis.vue`)

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

### 4. Dual Codes, Preview, and Validation (`ui/src/views/codes.vue`)

- Accepts an existing importable yuhun filter code only to obtain its 16-byte
  header, then generates and previews the D discard code and E rescue code.
- Shows cleanup/capacity comparison metrics, both codes, read-only generated
  rule groups, an account-pool funnel, and warnings about unexpected historical
  discard-pool restores.
- Copying/downloading codes and exporting the mobile handoff remain disabled
  until every strict gate passes: valid snapshot/targets/policy/header, group
  limit, lossless codec round trip, account preview, Tier 0 proof, and selected
  risk-tier simulation.
- Runs or cancels a fixed-size 100,000-item validation simulation and displays
  its progress and coverage summary.

### 5. In-game Reconciliation (`ui/src/views/reconcile.vue`)

- Starts by importing the private mobile handoff that contains only D/E codes,
  aggregate results, and the reconciliation checklist; it does not restore the
  desktop snapshot/session.
- Lists each generated rule group's expected count and accepts the actual game
  count. Delta and per-row status update immediately.
- Marks the run complete only when every expected/actual pair matches and can
  export the checklist as CSV.

## Reusable Presentation Components

- `ui/src/components/EChart.vue` renders responsive canvas ECharts and disposes
  its chart/resize observer on unmount. It is used for the snapshot distribution
  and plan funnel.
- `ui/src/components/ExcelColumnFilter.vue` is the analysis-table filter menu:
  searchable multi-select options with select-all, clear, and apply actions.

## UI Maintenance Boundaries

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
