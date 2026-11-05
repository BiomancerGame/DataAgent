// @vitest-environment happy-dom
import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DatasourceExplorerPanel } from "../components/DatasourceExplorerPanel";
import { LocaleProvider } from "../../../i18n/locale-context";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function loadPreview(data: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify({
    success: true,
    data: url.includes("/preview") ? data : {
      tables: [{ name: "orders", columns: [{ name: "id", type: "TEXT" }] }],
    },
  }), { status: 200 })));
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(LocaleProvider, null,
    createElement(DatasourceExplorerPanel, {
      item: { id: "demo", name: "Demo", enabled: true, settings: { type: "sqlite" } },
      onBack() {}, onEdit() {},
    }),
  )));
  const click = async (pattern: RegExp) => {
    const button = [...container.querySelectorAll("button")].find(b => pattern.test(b.textContent ?? ""));
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  await click(/^(Data|数据)$/);
  await click(/Load 50 rows|加载 50 行/);
  return container;
}

it("loads preview rows into the table after clicking Load 50 rows", async () => {
  const container = await loadPreview({ columns: [{ name: "id" }], rows: [["order-001"], [null]] });
  expect(container.querySelector("tbody")?.textContent).toContain("order-001");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/tables/orders/preview?limit=50&offset=0"), expect.anything());
});

it("shows an inline error when the server returns datasource metadata instead of rows", async () => {
  const container = await loadPreview({ id: "demo", name: "Demo", type: "sqlite" });
  expect(container.textContent).toContain("Invalid table preview response");
  expect(container.textContent).toContain("Demo");
});
