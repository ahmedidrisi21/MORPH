import { expect, test } from "@playwright/test";

test("toggles between two states with add, remove and move", async ({ page }) => {
  await page.goto("/playground");
  const ws = page.locator("[data-workspace]");
  await expect(ws).toHaveAttribute("data-workspace", "playground.a");
  await expect(page.locator('[data-component="play:chart:trend"]')).toBeVisible();
  await page.locator("[data-toggle]").click();
  await expect(ws).toHaveAttribute("data-workspace", "playground.b");
  await expect(page.locator('[data-component="play:chart:trend"]')).toHaveCount(0);
  await expect(page.locator('[data-component="play:table:customers"]')).toBeVisible();
  await expect(page.locator('[data-component="play:kpi:profit"]')).toBeVisible();
  const order = await page
    .locator('[data-slot="header"] [data-component]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-component")));
  expect(order.slice(0, 2)).toEqual(["play:kpi:orders", "play:kpi:revenue"]);
});

test("invalid props render MorphError and are traced", async ({ page }) => {
  await page.goto("/playground");
  await page.locator("[data-break]").click();
  await expect(page.locator('[data-morph-error="play:kpi:broken"]')).toBeVisible();
  await expect(page.locator("[data-render-errors]")).not.toHaveAttribute("data-render-errors", "0");
});
