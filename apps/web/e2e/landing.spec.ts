import { expect, test } from "playwright/test";

test("allows the Vercel staging toolbar through the content security policy", async ({ page }) => {
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";

  expect(policy).toContain("script-src 'self' 'unsafe-inline' https://vercel.live");
  expect(policy).toContain("frame-src https://vercel.live");
  expect(policy).toContain("wss://ws-us3.pusher.com");
});

test("presents the product without loading private workspace data", async ({ page }) => {
  let bootstrapRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/bootstrap") bootstrapRequests += 1;
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Remember why a decision was made/ })).toBeVisible();
  await expect(page.getByText("No sign-up required")).toBeVisible();
  expect(bootstrapRequests).toBe(0);
});

test("loads an editable sample into an isolated guest workflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Try a sample decision" }).first().click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "Bring in a decision" })).toBeVisible();
  await expect(page.getByLabel("Decision source")).toHaveValue(/Choose an identity provider/);
  await expect(page.getByLabel("Decision source")).toHaveValue(/audit logs/);
});

test("persists the selected light and dark appearance", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await page.getByRole("button", { name: "Choose color theme" }).click();
  await page.getByRole("menuitem", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

  await page.getByRole("button", { name: "Choose color theme" }).click();
  await page.getByRole("menuitem", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("keeps the landing story readable without horizontal scrolling on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Rationexa home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try a sample decision" }).first()).toBeVisible();
  await expect(page.getByText("Every decision has a living trail.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
