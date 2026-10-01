source visual truth path: browser comments 2026-06-29, remove right-side current input/current module description cards
implementation screenshot path: output/playwright/home-remove-info-blocks-20260629/right-panel-after-removal.png
additional screenshot path: output/playwright/home-remove-info-blocks-20260629/right-panel-expanded-after-removal.png
viewport: 1920x1080 desktop
state: unauthenticated home workbench, route-design module selected
full-view comparison evidence: output/playwright/home-remove-info-blocks-20260629/audit.json
focused region comparison evidence: `.settings-panel` first child is now `[data-cy="home-module-picker-toggle"]`; body text no longer includes the removed labels.

**Findings**
- No actionable P0/P1/P2 findings for the requested scope.

**Checks**
- Removed the `当前输入` description card from the right settings panel.
- Removed the `当前模块` description card and its stale selected-module styles.
- The right panel now starts with the collapsible `小模块选择` block.
- The small-module picker remains collapsed by default and expands to 6 modules on click.
- Desktop viewport has no horizontal overflow.

final result: passed

source visual truth path: C:/Users/xs615/AppData/Local/Temp/codex-clipboard-555c65c2-60c0-494f-be23-b5935aab9138.png and browser-attached task-list reference image
implementation screenshot path: output/playwright/results-layout-20260629/desktop-results.png
additional screenshot path: output/playwright/results-layout-20260629/mobile-results.png
viewport: 1600x1100 desktop, 390x920 mobile
state: results route layout shell; independent Playwright session has no valid user token, so live result cards are not populated in this audit
full-view comparison evidence: output/playwright/results-layout-20260629/audit.json
focused region comparison evidence: the task scoped to results task-list layout; desktop and mobile captures include top tabs, group panel, toolbar, batch controls, and result grid empty state.

**Findings**
- No actionable P0/P1/P2 findings.

**Checks**
- Fonts and typography: Chinese labels for 逆合成, 条件搜索, 分组, 搜索任务, 全选, 添加至分组, 删除, and empty state fit without clipping in desktop and mobile captures.
- Spacing and layout rhythm: results page now follows the reference structure: top task category tabs, left group panel, right task search and batch toolbar, then card grid/empty state.
- Colors and visual tokens: the page uses the green task-list treatment from the reference while keeping synon brand and existing Vuetify/Material Design icon vocabulary.
- Image quality and asset fidelity: real result cards use the existing `SmilesImage` structure renderer; no fake chemical structure artwork was introduced.
- Copy and content: task-list page copy is Chinese and connected to real ASKCOS result concepts.

**Patches Made**
- Replaced the old `/results` table-centric page with a task-list workbench layout in `src/views/results/Results.vue`.
- Added mode tabs for 逆合成 and 条件搜索, a tag-derived group panel, a search and batch-action toolbar, responsive result cards, and pagination.
- Preserved real API actions: list, refresh, share, rename, view settings, open route views, and delete. Also fixed delete operations to await the backend response before refreshing.

final result: passed

---

source visual truth path: browser comment 2026-06-29, right settings small-module picker should be collapsible by default
implementation screenshot path: output/playwright/home-module-picker-collapse-20260629/default-collapsed.png
additional screenshot path: output/playwright/home-module-picker-collapse-20260629/after-expanded.png
viewport: 1920x1080 desktop
state: unauthenticated home workbench, route-design module selected
full-view comparison evidence: output/playwright/home-module-picker-collapse-20260629/audit.json
focused region comparison evidence: `[data-cy="home-module-picker-toggle"]`, `[data-cy="home-module-picker-content"]`, and `[data-cy="home-module-choice-list"]` were checked before and after clicking the header.

**Findings**
- No actionable P0/P1/P2 findings for the requested scope.

**Checks**
- The right-side small-module picker is collapsed by default with `aria-expanded="false"`.
- The hidden content is not visible by default: module list and selected action panel are both collapsed.
- Clicking the header expands the picker with `aria-expanded="true"` and shows all current small modules.
- The expanded list count matches the header count.
- Clicking the header again collapses the picker.
- Desktop viewport has no horizontal overflow.

final result: passed

---

source visual truth path: browser comment 2026-06-29, remove duplicate top draw action and replace standardization with structure conversion
implementation screenshot path: output/playwright/home-structure-convert-20260629/desktop-after-convert.png
viewport: 1920x1080 desktop
state: unauthenticated home workbench, SMILES `C1=CC=CC=C1` converted through live RDKit endpoints and loaded into inline Ketcher
full-view comparison evidence: output/playwright/home-structure-convert-20260629/audit.json
focused region comparison evidence: `.structure-input-module`, `[data-cy="home-structure-convert"]`, and the inline Ketcher iframe were checked after clicking conversion.

**Findings**
- No actionable P0/P1/P2 findings for the requested scope.

**Checks**
- Duplicate top drawing entry removed from the SMILES input row; `DrawButton` is no longer rendered inside `SearchBar`.
- Old standardization control removed: `[data-cy="home-canonicalize"]` is absent and the visible action is `结构转换`.
- Conversion is functional, not just visual: clicking `结构转换` canonicalizes the input and loads a benzene structure into the inline Ketcher iframe.
- Right status is synchronized after conversion and shows `分子结构已识别`.
- The transient typing skeleton does not remain after conversion.
- Desktop viewport has no horizontal overflow.

final result: passed

---

source visual truth path: browser comments 2026-06-29, structure input module consolidation and Ketcher full display
implementation screenshot path: output/playwright/home-structure-card-ketcher-20260629/desktop-home.png
additional screenshot path: output/playwright/home-structure-card-ketcher-20260629/mobile-home.png
viewport: 1920x1080 desktop, 390x844 mobile
state: unauthenticated home workbench, inline Ketcher open by default
full-view comparison evidence: output/playwright/home-structure-card-ketcher-20260629/audit.json
focused region comparison evidence: `.structure-input-module`, `.inline-ketcher-frame`, and `.drawing-board-header` were checked in the live page.

**Findings**
- No actionable P0/P1/P2 findings for the requested desktop workbench scope.
- Mobile uses the same Ketcher iframe. The page itself has no horizontal overflow, but the Ketcher canvas content is wider than a narrow phone viewport and is clipped inside the editor. This is a Ketcher mobile-layout limitation and should be handled as a separate mobile editor task if needed.

**Checks**
- Header removal: `.drawing-board-header` count is 0, and the removed copy `结构画板` / `Ketcher 已打开` is not visible.
- Module consolidation: SMILES input and Ketcher iframe are both inside `.structure-input-module`.
- Desktop editor display: Ketcher iframe is 874x624 px at the checked viewport, with toolbar content visible.
- Mobile editor display: Ketcher frame keeps a 458 px visible editing area and the page has no horizontal overflow.
- Browser failures: no relevant 4xx/5xx frontend asset failures were detected in this run.

final result: passed

---

source visual truth path: browser comment 2026-06-29, home left module navigation top alignment
implementation screenshot path: output/playwright/home-left-top-align-20260629/desktop-home.png
viewport: 1920x1080 desktop
state: unauthenticated home workbench, default route-design group
full-view comparison evidence: output/playwright/home-left-top-align-20260629/audit.json
focused region comparison evidence: `.workbench-modules`, `.structure-panel`, and `.settings-panel` top positions were measured.

**Findings**
- No actionable P0/P1/P2 findings for the requested scope.

**Checks**
- Left navigation top now matches the center structure module top: left top 95, center top 95.
- Right settings panel also remains aligned at top 95.
- Top deltas are 0px for left-center and left-right.
- Desktop checked viewport has no horizontal overflow.

**Known External Signal**
- The page still receives a 404 from `/api/indigo/info`; this is an existing backend service-info endpoint issue, not caused by the alignment change.

final result: passed

---

source visual truth path: browser comment 2026-06-29, home workbench left module regroup request
implementation screenshot path: output/playwright/home-functional-regroup-20260629/desktop-default.png
additional screenshot path: output/playwright/home-functional-regroup-20260629/desktop-selectivity-risk.png and output/playwright/home-functional-regroup-20260629/mobile-default.png
viewport: 1920x1080 desktop, 390x844 mobile
state: unauthenticated home workbench, default route-design group and switched selectivity-risk group
full-view comparison evidence: output/playwright/home-functional-regroup-20260629/audit.json
focused region comparison evidence: left `.primary-module-card` groups and right `.module-choice-card` items were checked after group switching.

**Findings**
- No actionable P0/P1/P2 findings for the requested scope.

**Checks**
- Left module groups are now functional categories: 路线设计, 反应预测, 选择性与风险, 结构性质与采购, 任务与规则.
- Default group remains route planning, with 构建路线树 selected as the primary action.
- Right module list updates when switching groups; 选择性与风险 shows 杂质预测, 区域选择性预测, 芳香 C-H 官能团化.
- 结构性质与采购 shows 结构绘制, 商业原料检索, 分子复杂度, 溶解度预测, 溶剂筛选, QM 描述符.
- Desktop and mobile checked viewports have no horizontal overflow.

**Known External Signal**
- The page still receives a 404 from `/api/indigo/info`; this is an existing backend service-info endpoint issue, not caused by the module regrouping.

final result: passed

---

source visual truth path: browser comment 2026-06-29, duplicate second topbar removal
implementation screenshot path: output/playwright/single-topbar-20260629/desktop-home.png
additional screenshot path: output/playwright/single-topbar-20260629/mobile-home.png
viewport: 1440x1100 desktop, 390x920 mobile
state: unauthenticated home workbench
full-view comparison evidence: output/playwright/single-topbar-20260629/audit.json
focused region comparison evidence: the selected `.synon-mainbar` region no longer exists; screenshot top area shows only `.global-tabbar`.

**Findings**
- No actionable P0/P1/P2 findings for the requested scope.

**Checks**
- Duplicate navigation removal: `.synon-mainbar` count is 0.
- Duplicate workbench shortcut removal: `.workbench-link` count is 0.
- Top navigation: `.global-tabbar` remains as the single app-level navigation row.
- Layout: no horizontal overflow in desktop or mobile tested viewports.

**Known External Signal**
- The page still receives a 404 from `/api/indigo/info`; this is an existing backend service-info endpoint issue, not a frontend topbar asset issue.

final result: passed

---

source visual truth path: browser comments 2026-06-29, Comment 1 inline drawing board and Comment 2 history module removal
implementation screenshot path: output/playwright/inline-ketcher-home-20260629/desktop-home.png
additional screenshot path: output/playwright/inline-ketcher-home-20260629/mobile-home.png
viewport: 1440x1200 desktop, 390x980 mobile
state: unauthenticated home workbench
full-view comparison evidence: output/playwright/inline-ketcher-home-20260629/audit.json
focused region comparison evidence: structure board and lower home content area are visible in the same screenshots.

**Findings**
- No actionable P0/P1/P2 findings for the requested scope.

**Checks**
- Inline drawing board: Ketcher is embedded directly in the structure board and visible by default through `data-cy="home-inline-ketcher"`.
- Task history removal: `.history-panel` count is 0; the former home history card grid is no longer rendered.
- Task list routing: the toolbar label is now `任务列表` and links to `/results`.
- Responsiveness: desktop and mobile screenshots show no horizontal overflow in the tested viewports.

**Known External Signal**
- The page still receives a 404 from `/api/indigo/info`; this is an existing backend service-info endpoint issue, not a missing frontend asset from this UI change.

final result: passed

---

source visual truth path: user screenshot 2026-06-29, ChemAIRS-style full-height workbench occupancy
implementation screenshot path: C:\Users\xs615\AppData\Local\Temp\synon-home-2048x1256-final.png
viewport: 2048x1256 desktop, 100% browser zoom equivalent
state: unauthenticated home workbench, route-design selected, inline Ketcher open
full-view comparison evidence: browser metrics from real page at http://127.0.0.1:8769/
focused region comparison evidence: home shell, three workbench columns, outer Ketcher frame, and iframe internal body/app/main nodes were measured after deploy.

**Findings**
- No actionable P0/P1/P2 findings for the requested scope.

**Checks**
- Home workbench fills viewport: document scrollWidth/scrollHeight equal viewport, with no horizontal or vertical overflow.
- Left, center, and right columns stretch to 1143px within the shell.
- Ketcher outer frame is 1308x987 and iframe internal body/app/main nodes are 1306x987, so the drawing editor no longer renders as an 800x432 block in the upper-left.
- Module title text remains single-line height at desktop; Chinese titles do not split into individual characters.
- Buttons remain visible at the bottom of the workbench without page scrolling.

**Known External Signal**
- The page still receives a 404 from `/api/indigo/info`; this is an existing backend service-info endpoint issue, not caused by the full-height workbench change.

final result: passed
