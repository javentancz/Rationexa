import { expect, test } from "playwright/test";

test("keeps an unfinished draft mounted across tabs and lets the reviewer discard it", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByLabel("Decision source").fill("Draft decision context that must survive navigation.");

  await page.getByRole("button", { name: "All decisions" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("button", { name: "Continue current draft" })).toContainText("Draft decision context");

  await page.getByRole("button", { name: /Discard .* draft/ }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("No finalized decision records will be changed");
  await dialog.getByRole("button", { name: "Discard draft" }).click();

  await expect(page.getByRole("button", { name: "Continue current draft" })).toHaveCount(0);
  await expect(page.getByText("Draft discarded")).toBeVisible();
});

test("reuses workspace and account data when moving between application tabs", async ({ page }) => {
  let bootstrapRequests = 0;
  let accountSettingsRequests = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/v1/bootstrap") bootstrapRequests += 1;
    if (pathname === "/v1/account-settings" && request.method() === "GET") accountSettingsRequests += 1;
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Bring in a decision" })).toBeVisible();
  await page.getByRole("button", { name: "Account and provider keys" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Account & AI connections" })).toBeVisible();
  await expect(page.getByText("Workspace & provider keys", { exact: true })).toHaveCount(0);
  const accountRequestsAfterInitialLoad = accountSettingsRequests;
  expect(accountRequestsAfterInitialLoad).toBe(1);
  await page.getByRole("button", { name: "All decisions" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("button", { name: "Account and provider keys" }).click();
  await expect(page.getByRole("heading", { name: "Account & AI connections" })).toBeVisible();
  await page.getByRole("button", { name: "New decision review" }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  expect(bootstrapRequests).toBe(1);
  expect(accountSettingsRequests).toBe(accountRequestsAfterInitialLoad);
});

test("renders a fresh saved workspace without refetching it on hard refresh", async ({ page }) => {
  let bootstrapRequests = 0;
  const hydrationErrors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/bootstrap") bootstrapRequests += 1;
  });
  page.on("pageerror", (error) => {
    if (error.message.includes("Hydration failed")) hydrationErrors.push(error.message);
  });

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Decision library" })).toBeVisible();
  await expect(page.getByText("Your records", { exact: true })).toHaveCSS("text-decoration-line", "none");
  await expect.poll(() => page.evaluate(() => (
    Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .some((key) => key?.startsWith("rationexa-refresh-v1:workspace-bootstrap"))
  ))).toBe(true);
  const requestsAfterInitialLoad = bootstrapRequests;

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Decision library" })).toBeVisible({ timeout: 1_000 });
  await page.waitForTimeout(250);
  expect(bootstrapRequests).toBe(requestsAfterInitialLoad);
  expect(hydrationErrors).toEqual([]);
});
