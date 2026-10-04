import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const library = process.env.X_SYNTH_PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(library),
  { expect } = require(`${library}/test`);
const baseURL = process.env.X_SYNTH_BROWSER_URL || "http://127.0.0.1:8771";
const evidence = process.env.X_SYNTH_BROWSER_EVIDENCE;
const jobId = process.env.X_SYNTH_BROWSER_JOB_ID;
assert.match(
  jobId || "",
  /^[a-f0-9]{32}$/,
  "bind acceptance to an actual software job ID",
);
const failures = [];

async function json(response) {
  assert.equal(
    response.ok(),
    true,
    `${response.status()}: ${await response.text()}`,
  );
  return response.json();
}
async function capture(page, name) {
  if (!evidence) return;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, `${name}.png`) });
}
async function noOverflow(page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  assert.equal(
    await page
      .locator(".workspace-page")
      .evaluate((element) => element.scrollWidth > element.clientWidth + 1),
    false,
  );
}
async function images(page, region) {
  await region.scrollIntoViewIfNeeded();
  await expect
    .poll(
      () =>
        region.locator(".smiles-image-container").evaluateAll((items) => {
          const visible = items.filter((item) => {
            const r = item.getBoundingClientRect();
            return (
              r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0
            );
          });
          return (
            visible.length > 0 &&
            visible.every((item) => {
              const image = item.querySelector("img");
              return (
                image?.complete &&
                image.naturalWidth > 0 &&
                Number(getComputedStyle(image).opacity) === 1
              );
            })
          );
        }),
      { timeout: 30000 },
    )
    .toBe(true);
  const pixels = await region
    .locator("img")
    .first()
    .evaluate((item) => {
      const canvas = document.createElement("canvas");
      canvas.width = item.naturalWidth;
      canvas.height = item.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(item, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let index = 0; index < data.length; index += 4)
        if (
          data[index + 3] > 30 &&
          Math.min(data[index], data[index + 1], data[index + 2]) < 150
        )
          ink++;
      return ink;
    });
  assert.ok(
    pixels > 20,
    "the chemical structure must contain real rendered bonds, not a blank image",
  );
}
async function exportedStructures(page, graph, document, bytes) {
  const regions = await graph.evaluate((surface, nodes) => {
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    return nodes
      .filter((node) => node.type === "molecule")
      .map((node) => {
        const element = surface.querySelector(`[data-id="${node.id}"]`);
        const box = element.getBoundingClientRect();
        const image = element.querySelector("img").getBoundingClientRect();
        const scale = box.width / element.offsetWidth;
        return {
          id: node.id,
          x: Math.round(
            node.position.x - minX + 32 + (image.left - box.left) / scale + 2,
          ),
          y: Math.round(
            node.position.y - minY + 32 + (image.top - box.top) / scale + 2,
          ),
          width: Math.floor(image.width / scale - 4),
          height: Math.floor(image.height / scale - 4),
        };
      });
  }, document.graph.nodes);
  const counts = await page.evaluate(
    async ({ source, regions }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return regions.map((region) => {
        if (
          region.x < 0 ||
          region.y < 0 ||
          region.x + region.width > canvas.width ||
          region.y + region.height > canvas.height
        )
          throw new Error(
            `Exported chemical structure is clipped: ${region.id}`,
          );
        const data = context.getImageData(
          region.x,
          region.y,
          region.width,
          region.height,
        ).data;
        let ink = 0;
        for (let index = 0; index < data.length; index += 4)
          if (
            data[index + 3] > 30 &&
            Math.min(data[index], data[index + 1], data[index + 2]) < 110
          )
            ink++;
        return { id: region.id, ink };
      });
    },
    { source: `data:image/png;base64,${bytes.toString("base64")}`, regions },
  );
  assert.ok(counts.length > 0);
  for (const { id, ink } of counts)
    assert.ok(
      ink > 20,
      `Exported structure ${id} must retain legible chemical bonds, not just node labels (${ink} pixels)`,
    );
}
async function withPage(width, name, action) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({
    baseURL,
    viewport: { width, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await action(page);
    assert.deepEqual(errors, []);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    await capture(page, `${name}-failure`);
    throw error;
  } finally {
    await browser.close();
  }
}

test(
  "real task metadata, owned grouping and recoverable archives",
  { timeout: 180000 },
  async () => {
    await withPage(1440, "task-management", async (page) => {
      const initial = await json(
        await page.request.get(`/api/v1/unified-route/jobs/${jobId}`),
      );
      assert.equal(
        initial.status,
        "completed",
        "use a real completed model job, never a seeded route",
      );
      const original = await json(
        await page.request.get(`/api/v1/unified-route/jobs/${jobId}/result`),
      );
      const groupName = `路线对照-${Date.now()}`;
      let groupId;
      try {
        await page.goto("/results");
        await expect(page.locator(`[data-task-id="${jobId}"]`)).toBeVisible();
        await images(page, page.locator(`[data-task-id="${jobId}"]`));
        await page
          .getByRole("button", { name: "新建分组", exact: true })
          .click();
        await page
          .getByRole("textbox", { name: "分组名称", exact: true })
          .fill(groupName);
        await page.getByRole("button", { name: "保存", exact: true }).click();
        const created = await json(
          await page.request.get("/api/v1/results/groups"),
        );
        const groups = Array.isArray(created) ? created : created.groups;
        groupId = groups.find((group) => group.name === groupName)?.id;
        assert.ok(groupId);
        const card = page.locator(`[data-task-id="${jobId}"]`);
        await card.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "批量移至分组", exact: true })
          .click();
        await page.getByText(groupName, { exact: true }).last().click();
        await page
          .getByRole("button", { name: new RegExp(groupName) })
          .first()
          .click();
        await expect(page.locator(".task-card")).toHaveCount(1);
        await page.reload();
        await expect(page.locator(`[data-task-id="${jobId}"]`)).toBeVisible();
        const grouped = await json(
          await page.request.get(`/api/v1/unified-route/jobs/${jobId}`),
        );
        assert.equal(grouped.group_id, groupId);
        assert.equal(grouped.revision, initial.revision);
        await capture(page, "tasks-grouped-desktop");
        await noOverflow(page);
        await page
          .locator(`[data-task-id="${jobId}"]`)
          .getByRole("checkbox")
          .check();
        page.once("dialog", (dialog) => dialog.accept());
        await page
          .getByRole("button", { name: "所选任务移入回收箱", exact: true })
          .click();
        await page.getByRole("button", { name: "回收箱", exact: true }).click();
        await expect(page.locator(`[data-task-id="${jobId}"]`)).toBeVisible();
        const archived = await json(
          await page.request.get(`/api/v1/unified-route/jobs/${jobId}`),
        );
        assert.equal(archived.archived, true);
        assert.equal(archived.status, initial.status);
        await page
          .locator(`[data-task-id="${jobId}"]`)
          .getByRole("checkbox")
          .check();
        await page
          .getByRole("button", { name: "恢复所选任务", exact: true })
          .click();
        await page
          .getByRole("button", { name: "全部任务", exact: false })
          .click();
        await expect(page.locator(`[data-task-id="${jobId}"]`)).toBeVisible();
        const restored = await json(
          await page.request.get(`/api/v1/unified-route/jobs/${jobId}`),
        );
        assert.equal(restored.archived, false);
        assert.equal(restored.status, initial.status);
        const after = await json(
          await page.request.get(`/api/v1/unified-route/jobs/${jobId}/result`),
        );
        assert.deepEqual(after.settings, original.settings);
        assert.deepEqual(
          after.result.unified_route_pool.selected_routes,
          original.result.unified_route_pool.selected_routes,
        );
        await page
          .locator(".task-history")
          .getByRole("textbox", { name: "名称、SMILES 或 ID", exact: true })
          .fill(jobId);
        await expect(page.locator(".task-card")).toHaveCount(1);
        await page
          .locator(`[data-task-id="${jobId}"]`)
          .getByRole("link", { name: /^打开路线结果/ })
          .click();
        await page
          .getByRole("link", { name: "返回任务列表", exact: true })
          .click();
        await expect(
          page.locator(".task-history").getByRole("textbox", {
            name: "名称、SMILES 或 ID",
            exact: true,
          }),
        ).toHaveValue(jobId);
        assert.equal(
          (
            await page.request.get("/api/v1/results/page", {
              headers: { Origin: "https://untrusted.example" },
            })
          ).status(),
          403,
        );
      } finally {
        const current = await json(
          await page.request.get(`/api/v1/unified-route/jobs/${jobId}`),
        );
        if (current.archived)
          await json(
            await page.request.post("/api/v1/results/batch", {
              data: {
                action: "restore",
                items: [{ id: jobId, revision: current.history_revision }],
              },
            }),
          );
        if (groupId) {
          const data = await json(
            await page.request.get("/api/v1/results/groups"),
          );
          const group = (Array.isArray(data) ? data : data.groups).find(
            (item) => item.id === groupId,
          );
          if (group)
            await json(
              await page.request.delete(
                `/api/v1/results/groups/${groupId}?revision=${group.revision}`,
              ),
            );
        }
      }
    });
  },
);

for (const width of [1440, 1024, 390]) {
  test(
    `actual route list, multi-route preview, materials and exports at ${width}px`,
    { timeout: 180000 },
    async () => {
      await withPage(width, `route-${width}`, async (page) => {
        const result = await json(
          await page.request.get(`/api/v1/unified-route/jobs/${jobId}/result`),
        );
        const routes = result.result.unified_route_pool.selected_routes;
        assert.ok(routes.length >= 3 && routes.length <= 10);
        await page.goto(`/results/${jobId}`);
        const reader = page.locator(".route-reader");
        await expect(reader.locator(".reader-overview-entry")).toHaveCount(
          routes.length,
        );
        assert.ok(
          await reader
            .locator(".route-overview-list")
            .first()
            .evaluate(
              (element) =>
                element.getBoundingClientRect().width >
                Math.min(300, innerWidth * 0.6),
            ),
          "selection controls cannot create an implicit grid track or collapse the route",
        );
        await images(page, reader.locator(".reader-overview-entry").first());
        await capture(page, `route-list-${width}`);
        await noOverflow(page);
        await reader
          .getByRole("checkbox", { name: "选择R001", exact: true })
          .check();
        await reader
          .getByRole("checkbox", { name: "选择R002", exact: true })
          .check();
        await reader
          .getByRole("button", { name: "查看选中路线", exact: true })
          .click();
        await expect(reader.getByRole("tab")).toHaveCount(2);
        await reader.getByRole("tab", { name: "R002", exact: true }).click();
        await expect(
          reader.getByRole("tab", { name: "R002", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        const graph = reader.locator(
          ".reader-detail-body .route-graph-surface",
        );
        await expect(graph.locator(".vue-flow__node-reaction")).toHaveCount(
          routes[1].steps.length,
        );
        await images(page, graph);
        await capture(page, `route-preview-${width}`);
        await noOverflow(page);
        await reader
          .getByRole("button", { name: "物料清单", exact: true })
          .click();
        await expect(reader.locator(".route-materials tbody tr")).toHaveCount(
          new Set(routes[1].starting_materials).size,
        );
        await reader
          .getByRole("button", { name: "核对采购目录", exact: true })
          .click();
        await expect(
          reader.getByText("已核对当前供应商目录快照", { exact: true }),
        ).toBeVisible();
        const stock = await json(
          await page.request.post("/api/v1/stock/lookup", {
            data: { smiles: routes[1].starting_materials },
          }),
        );
        assert.ok(
          routes[1].starting_materials.every(
            (smiles) => stock.results[smiles].length > 0,
          ),
        );
        await capture(page, `route-materials-${width}`);
        await noOverflow(page);
        await reader
          .getByRole("button", { name: "路线图", exact: true })
          .click();
        await reader.getByRole("button", { name: "导出", exact: true }).click();
        const downloaded = page.waitForEvent("download");
        await page.getByText("路线文档 JSON", { exact: true }).click();
        const file = await downloaded;
        const document = JSON.parse(await readFile(await file.path(), "utf8"));
        assert.equal(document.format, "x-synth-route");
        assert.equal(document.version, 1);
        assert.equal(
          document.graph.nodes.find(
            (node) => node.id === document.graph.target_id,
          ).smiles,
          routes[1].target_smiles,
        );
        assert.equal(
          document.graph.nodes.filter((node) => node.type === "reaction")
            .length,
          routes[1].steps.length,
        );
        if (width === 1440) {
          await reader
            .getByRole("button", { name: "导出", exact: true })
            .click();
          // Reproduce an immediate export during a real browser image fade.
          await graph.locator("img").evaluateAll((items) => {
            for (const image of items)
              image.animate([{ opacity: 0 }, { opacity: 1 }], {
                duration: 1800,
                fill: "forwards",
              });
          });
          const png = page.waitForEvent("download");
          await page.getByText("完整路线图 PNG", { exact: true }).click();
          const image = await png;
          const bytes = await readFile(await image.path());
          assert.ok(bytes.length > 10000);
          assert.equal(bytes.subarray(1, 4).toString(), "PNG");
          await exportedStructures(page, graph, document, bytes);
          if (evidence)
            await writeFile(path.join(evidence, "complete-route.png"), bytes);
        }
        await graph
          .locator(".vue-flow__node-molecule")
          .first()
          .getByRole("button", { name: "查看化合物详情", exact: true })
          .click();
        await expect(
          reader
            .locator(".route-inspector")
            .getByRole("button", { name: "采购记录", exact: true }),
        ).toBeVisible();
        await reader
          .locator(".route-inspector")
          .getByRole("button", { name: "关闭详情", exact: true })
          .click();
        await graph.locator('[data-id="r-1"]').click();
        await expect(reader.locator(".route-inspector")).toBeVisible();
        const rxn = `${routes[1].steps[0].precursors.join(".")}>>${routes[1].steps[0].product}`;
        const calls = [];
        page.on("request", (request) => {
          if (new URL(request.url()).pathname === "/api/v1/conditions/predict")
            calls.push(request.method());
        });
        await reader
          .locator(".route-inspector")
          .getByRole("button", { name: "条件预测", exact: true })
          .click();
        await expect(page).toHaveURL(new RegExp(`/results/${jobId}$`));
        await expect(
          page.getByRole("heading", { name: "反应条件预测", exact: true }),
        ).toBeVisible();
        assert.equal(
          calls.length,
          0,
          "opening a route condition dialog never submits a prediction",
        );
        if (width === 1440) {
          const response = page.waitForResponse(
            (value) =>
              new URL(value.url()).pathname === "/api/v1/conditions/predict" &&
              value.request().method() === "POST",
          );
          await page
            .getByRole("button", { name: "预测条件", exact: true })
            .click();
          const prediction = await json(await response);
          assert.equal(prediction.model, "nn_v1");
          assert.equal(prediction.evidence_type, "model_prediction");
          assert.ok(
            prediction.conditions.length > 0 &&
              prediction.conditions.length <= 3,
          );
          const payload = JSON.parse((await response).request().postData());
          assert.equal(`${payload.reactants}>>${payload.product}`, rxn);
          await expect(
            page.locator(".route-condition-dialog .condition-table tbody tr"),
          ).toHaveCount(prediction.conditions.length);
          await expect(
            page.getByRole("button", { name: "预测条件", exact: true }),
          ).toBeEnabled();
          await images(page, page.locator(".route-condition-dialog"));
          await capture(page, `route-condition-dialog-${width}`);
          const record = await json(
            await page.request.get(`/api/v1/analyses/${prediction.record_id}`),
          );
          assert.equal(record.status, "completed");
        }
        await page
          .getByRole("button", { name: "关闭条件预测", exact: true })
          .click();
        await expect(reader.locator(".route-inspector")).toBeVisible();
        await noOverflow(page);
        if (width === 1440) {
          await page.goto(`/results/${jobId}`);
          await page
            .locator(".reader-overview-entry")
            .nth(1)
            .getByRole("button", { name: "查看完整路线", exact: true })
            .click();
          const created = page.waitForResponse(
            (response) =>
              new URL(response.url()).pathname ===
                "/api/v1/route-documents/from-task" &&
              response.request().method() === "POST",
          );
          await page
            .locator(".reader-route-summary")
            .getByRole("button", { name: "编辑副本", exact: true })
            .click();
          const response = await created;
          assert.equal(response.request().postDataJSON().route_index, 1);
          const document = await json(response);
          await expect(page).toHaveURL(/\/editor\//);
          assert.equal(document.source.route_id, routes[1].route_id);
          await expect(
            page.getByRole("textbox", { name: "路线名称", exact: true }),
          ).toBeVisible();
          await capture(page, "route-editor-desktop");
          await noOverflow(page);
        }
      });
    },
  );
}

for (const width of [1440, 390]) {
  test(
    `real patent lookup, original citations and chemical identity at ${width}px`,
    { timeout: 120000 },
    async () => {
      await withPage(width, `references-${width}`, async (page) => {
        await page.goto("/references");
        const product = page.getByRole("textbox", {
          name: "产物",
          exact: true,
        });
        await product.fill("CCOC(=O)c1ccccc1");
        const button = page.locator('[data-cy="reference-search-submit"]');
        await expect(button).toBeEnabled();
        const done = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/v1/references/search" &&
            response.request().method() === "POST",
        );
        await button.click();
        const response = await done;
        const result = await json(response);
        assert.ok(result.count > 0);
        const patents = result.results.filter(
          (row) => row.provenance.source === "USPTO_FULL",
        );
        assert.ok(patents.length > 0);
        assert.ok(patents.every((row) => row.conditions === null));
        await expect(page.locator('[data-cy="reference-row"]')).toHaveCount(
          result.count,
        );
        const row = page
          .locator(
            '[data-cy="reference-row"][data-reference-source="USPTO_FULL"]',
          )
          .first();
        await images(page, row);
        await row.getByText("引用与原始记录", { exact: true }).click();
        await expect(row.getByRole("link")).toHaveAttribute(
          "href",
          /^https:\/\/patents.google.com\/patent\//,
        );
        await capture(page, `patent-references-${width}`);
        await noOverflow(page);
        await product.fill("[13CH3]COC(=O)c1ccccc1");
        await expect(page.locator('[data-cy="reference-row"]')).toHaveCount(0);
        const isotope = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/v1/references/search" &&
            response.request().method() === "POST",
        );
        await button.click();
        const exact = await json(await isotope);
        assert.equal(
          exact.count,
          0,
          "unlabelled reactions cannot match an isotopically distinct product",
        );
        await expect(
          page.getByText("未找到该产物结构的参考反应。", { exact: true }),
        ).toBeVisible();
      });
    },
  );
}
