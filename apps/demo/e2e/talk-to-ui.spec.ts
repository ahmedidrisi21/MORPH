import { expect, type Page, test } from "@playwright/test";

// The §1 script with no keys (replay, falling back to rules). Runs at desktop and 360 px.

/**
 * One turn: click a suggestion and wait until the runtime has finished it. The strip's `data-trace`
 * changes when a new trace is recorded, and `data-pending-kind` is the state's own gate outcome, so
 * neither depends on a banner that is still animating out from the previous turn.
 */
async function ask(page: Page, intent: string) {
  const strip = page.locator("[data-adaptive-strip]");
  const before = (await strip.getAttribute("data-trace")) ?? "";
  await page.locator(`[data-suggestion="${intent}"]`).click();
  await expect(strip).not.toHaveAttribute("data-trace", before);
  await expect(page.locator("[data-workspace]")).toHaveAttribute("aria-busy", "false");
  // Recorded Jev answers can land in the confirm band (SPEC §9): accept it, as a user would.
  if ((await strip.getAttribute("data-pending-kind")) === "confirm") {
    await page
      .locator('[data-pending="confirm"]')
      .last()
      .getByRole("button", { name: "Yes" })
      .click();
    await expect(strip).toHaveAttribute("data-pending-kind", "");
    // The accepted banner animates out; wait for it so the next turn never sees it.
    await expect(page.locator("[data-pending]")).toHaveCount(0);
  }
}

async function workspace(page: Page) {
  return page.locator("[data-workspace]").getAttribute("data-workspace");
}

test("runs the 4-turn script without a page reload", async ({ page }) => {
  await page.goto("/");
  const ws = page.locator("[data-workspace]");
  await expect(ws).toHaveAttribute("data-workspace", "overview.default");
  // A marker on window proves no navigation happens between turns.
  await page.evaluate(() => {
    (window as unknown as { __morphNoReload: boolean }).__morphNoReload = true;
  });

  await ask(page, "Why did revenue fall?");
  await expect(ws).toHaveAttribute("data-workspace", /^investigation\./);
  await expect(page.locator('[data-component*="kpi:revenue"]').first()).toBeVisible();

  await ask(page, "Show me the customers.");
  await expect(ws).toHaveAttribute(
    "data-workspace",
    /^(investigation\.by_customer|customers\.list|customers\.at_risk)$/,
  );
  const beforeRefine = await workspace(page);

  await ask(page, "Only show customers I can save.");
  await expect(ws).toHaveAttribute("data-filter", "recoverable");
  expect(await workspace(page)).toBe(beforeRefine);

  await ask(page, "What should I do?");
  await expect(ws).toHaveAttribute("data-workspace", /^action\./);
  await expect(page.locator('[data-component*=":payroll_panel:"]')).toHaveCount(0);

  expect(
    await page.evaluate(() => (window as unknown as { __morphNoReload?: boolean }).__morphNoReload),
  ).toBe(true);
});

test("alternates switch views locally and undo restores the previous one", async ({ page }) => {
  await page.goto("/");
  const ws = page.locator("[data-workspace]");
  await expect(ws).toHaveAttribute("data-workspace", "overview.default");
  await ask(page, "Why did revenue fall?");
  const first = await workspace(page);

  const alternate = page.locator("[data-alternate]").first();
  await expect(alternate).toBeVisible();
  const target = await alternate.getAttribute("data-alternate");
  await alternate.click();
  await expect(ws).toHaveAttribute("data-workspace", target ?? "");

  await page.locator("[data-undo]").click();
  await expect(ws).toHaveAttribute("data-workspace", first ?? "");
});

test("the inspector opens from “Why this?” and with ?inspect=1", async ({ page }) => {
  await page.goto("/?inspect=1");
  await expect(page.locator("[data-inspector]")).toBeVisible();
  // An auto outcome: on mobile the open inspector would cover a confirm button.
  await ask(page, "Show me the customers.");
  await expect(page.locator("[data-inspector] [data-gate]")).toBeVisible();
  await expect(page.locator("[data-inspector] [data-metrics]")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("[data-inspector]")).toHaveCount(0);

  const why = page.locator("[data-why]").first();
  await why.focus();
  await why.click();
  await expect(page.locator("[data-inspector] [data-focus]")).toBeVisible();
});

test("the layout does not scroll sideways", async ({ page }) => {
  await page.goto("/");
  await ask(page, "Show me the customers.");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
