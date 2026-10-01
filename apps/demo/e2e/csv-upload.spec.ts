import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// CSV upload (docs/backlog.md#csv-upload): a file with its own column names becomes a workspace.

const shopCsv = fileURLToPath(new URL("./fixtures/shop.csv", import.meta.url));

test("builds a workspace from an uploaded CSV and goes back to the demo data", async ({ page }) => {
  await page.goto("/");
  const ws = page.locator("[data-workspace]");
  await expect(ws).toHaveAttribute("data-workspace", "overview.default");

  // The narrative tier is off in the e2e server, so nothing derived from the file leaves the browser.
  await expect(page.locator("[data-csv-privacy]")).toHaveText("Stays in your browser.");

  await page.locator("[data-csv-input]").setInputFiles(shopCsv);
  const mapping = page.locator("[data-csv-mapping]");
  await expect(mapping).toBeVisible();
  await expect(mapping.locator('[data-role="date"]')).toHaveValue("Order Date");
  await expect(mapping.locator('[data-role="revenue"]')).toHaveValue("Total");
  await expect(mapping.locator('[data-role="customer"]')).toHaveValue("Client");

  await page.locator("[data-csv-build]").click();
  await expect(mapping).toBeHidden();
  await expect(page.locator("[data-csv-current]")).toHaveText("Showing shop.csv");
  await expect(ws).toHaveAttribute("data-workspace", "overview.default");

  await page.locator('[data-suggestion="Why did revenue fall?"]').click();
  await expect(ws).toHaveAttribute("aria-busy", "false");
  // Recorded Jev answers can land in the confirm band (SPEC §9): accept it, as a user would.
  const confirm = page.locator('[data-pending="confirm"]');
  if (await confirm.isVisible()) await confirm.getByRole("button", { name: "Yes" }).click();
  await expect(ws).toHaveAttribute("data-workspace", /^investigation\./);

  await page.getByRole("button", { name: "Back to demo data" }).click();
  await expect(page.locator("[data-csv-current]")).toHaveCount(0);
  await expect(ws).toHaveAttribute("data-workspace", "overview.default");
});

test("explains a file it cannot use", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-workspace]")).toBeVisible();
  await page.locator("[data-csv-input]").setInputFiles({
    name: "notes.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("just one column\nhello\n"),
  });
  await expect(page.locator("[data-csv-upload] [role=alert]")).toContainText("3+ columns");
});
