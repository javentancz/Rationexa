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
  await expect(page.getByRole("heading", { name: "Workspace settings" })).toBeVisible();
  await expect(page.getByText("Workspace & provider keys", { exact: true })).toHaveCount(0);
  const accountRequestsAfterInitialLoad = accountSettingsRequests;
  expect(accountRequestsAfterInitialLoad).toBe(1);
  await page.getByRole("button", { name: "All decisions" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("button", { name: "Account and provider keys" }).click();
  await expect(page.getByRole("heading", { name: "Workspace settings" })).toBeVisible();
  await page.getByRole("button", { name: "New decision review" }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  expect(bootstrapRequests).toBe(1);
  expect(accountSettingsRequests).toBe(accountRequestsAfterInitialLoad);
});

test("filters decision criticality locally without fetching another library", async ({ page }) => {
  let decisionListRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/v1/decisions" && request.method() === "GET") decisionListRequests += 1;
  });

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Decision library" })).toBeVisible();
  const requestsAfterLoad = decisionListRequests;

  await page.getByRole("button", { name: "Critical", exact: true }).click();
  await expect(page.getByRole("button", { name: "Critical", exact: true })).toHaveClass(/active/);
  await page.getByRole("button", { name: "Important", exact: true }).click();
  await expect(page.getByRole("button", { name: "Important", exact: true })).toHaveClass(/active/);
  await page.getByRole("button", { name: "Routine", exact: true }).click();
  await expect(page.getByRole("button", { name: "Routine", exact: true })).toHaveClass(/active/);
  await page.getByRole("button", { name: "All decisions", exact: true }).click();

  expect(decisionListRequests).toBe(requestsAfterLoad);
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
  await expect(page.getByRole("heading", { name: "Your decisions" })).toHaveCSS("text-decoration-line", "none");
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

test("renders a stale saved workspace while hard-refresh revalidation is pending", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Decision library" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .some((key) => key?.startsWith("rationexa-refresh-v1:workspace-bootstrap"))
  ))).toBe(true);

  const cachedBootstrap = await page.evaluate(() => {
    const key = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .find((candidate) => candidate?.startsWith("rationexa-refresh-v1:workspace-bootstrap"));
    if (!key) throw new Error("Workspace bootstrap snapshot was not saved");
    const snapshot = JSON.parse(sessionStorage.getItem(key) ?? "null");
    snapshot.savedAt = Date.now() - 6 * 60_000;
    sessionStorage.setItem(key, JSON.stringify(snapshot));
    return snapshot.value;
  });

  let releaseRevalidation!: () => void;
  const revalidationGate = new Promise<void>((resolve) => { releaseRevalidation = resolve; });
  await page.route(/\/v1\/bootstrap(?:\?.*)?$/, async (route) => {
    await revalidationGate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cachedBootstrap) });
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Decision library" })).toBeVisible({ timeout: 1_000 });
  await expect(page.getByRole("heading", { name: "Your decisions" })).toBeVisible();
  releaseRevalidation();
});


test("asks before replacing an unfinished draft from the empty library", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByLabel("Decision source").fill("Keep this unfinished reasoning.");
  await page.getByRole("button", { name: "All decisions", exact: true }).click();
  await page.getByLabel("Search decisions").fill("no-match-0908");
  await page.getByRole("button", { name: "New decision", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Start a new decision?");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Continue current draft" }).click();
  await expect(page.getByLabel("Decision source")).toHaveValue("Keep this unfinished reasoning.");
});
