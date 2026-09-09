import { expect, test } from "playwright/test";

test("allows the Vercel staging toolbar through the content security policy", async ({ page }) => {
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";

  expect(policy).toContain("script-src 'self' 'unsafe-inline' https://vercel.live");
  if (process.env.CI !== "true") expect(policy).toContain("'unsafe-eval'");
  expect(policy).toContain("frame-src https://vercel.live");
  expect(policy).toContain("wss://ws-us3.pusher.com");
});

test("presents the product without loading private workspace data", async ({ page }) => {
  let bootstrapRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/v1/bootstrap") bootstrapRequests += 1;
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Remember the why/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Try it without an account or model key." })).toBeVisible();
  expect(bootstrapRequests).toBe(0);
});

test("links to a readable public-preview privacy policy", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Privacy & data" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy and data use" })).toBeVisible();
  await expect(page.getByText("Guest workspaces are isolated through a browser cookie")).toBeVisible();
  await expect(page.getByText("Use a restricted, revocable provider key with a spending limit.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Rationexa home" })).toHaveAttribute("href", "/");
});

test("offers concrete guided decision cases", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Start with a decision you recognize." })).toBeVisible();
  const cases = page.getByRole("region", { name: "Guided decision cases" });
  await expect(cases.getByRole("link")).toHaveCount(3);
  await expect(cases.getByRole("link", { name: /Choose an identity provider/ })).toHaveAttribute("href", "/workspace?sample=vendor-review");
  await expect(cases).toContainText("Launch an annual starter plan");
  await expect(cases).toContainText("Adopt a managed search service");
});

test("lets visitors inspect all four workflow stages in the product preview", async ({ page }) => {
  await page.goto("/");

  const stages = [
    { tab: "Import", content: "Bring in a decision" },
    { tab: "Review", content: "Confirm what mattered" },
    { tab: "Finalize", content: "Save the reviewed record" },
    { tab: "Revisit", content: "Choose an identity provider" },
  ];

  for (const stage of stages) {
    const tab = page.getByRole("tab", { name: new RegExp(`^\\d ${stage.tab}$`) });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel").getByRole("heading", { name: stage.content })).toBeVisible();
  }
});

test("keeps the landing logo legible in dark mode", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.goto("/");

  const mark = page.getByRole("navigation", { name: "Main navigation" }).getByLabel("Rationexa home").locator("span");
  await expect(mark).toHaveCSS("background-color", "rgb(119, 189, 145)");
  await expect(mark).toHaveCSS("color", "rgb(12, 26, 17)");
});

test("keeps the landing navigation fixed in view while scrolling", async ({ page }) => {
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight / 2 }));

  await expect.poll(async () => navigation.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(0);
});

test("loads an editable sample into an isolated guest workflow", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("rationexa-workspace-draft-v1", JSON.stringify({
      workspaceId: "guest-browser",
      source: "",
      evidence: "",
      sourceMode: "paste",
      view: "workspace",
      workflowView: 1,
      selectedModelId: "rules-v1",
      comparisonModelId: "",
      compareMode: false,
      criticality: "important",
    }));
  });
  await page.getByRole("link", { name: "Try a sample decision" }).first().click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "Bring in a decision" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Guided example" })).toContainText("Start with the original reasoning");
  await expect(page.getByLabel("Decision source")).toHaveValue(/Choose an identity provider/);
  await expect(page.getByLabel("Decision source")).toHaveValue(/audit logs/);
});

test("loads the selected real-world guided case", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("region", { name: "Guided decision cases" }).getByRole("link", { name: /Launch an annual starter plan/ }).click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("region", { name: "Guided example" })).toContainText("Launch pricing guide");
  await expect(page.getByLabel("Decision source")).toHaveValue(/\$240 per year/);
  await expect(page.getByLabel("Decision source")).toHaveValue(/churn exceeds 12%/);
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
  await expect(page.getByRole("heading", { name: "AI proposes. A person decides." })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight / 2 }));
  await expect.poll(async () => navigation.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("offers samples inside an empty workspace without replacing typed work", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Build or buy", exact: true }).click();
  await expect(page.getByLabel("Decision source")).toHaveValue(/managed search service/);
  await expect(page.getByRole("region", { name: "Guided example" })).toBeVisible();
  await page.getByLabel("Decision source").fill("My own decision reasoning.");
  await expect(page.getByRole("button", { name: "Launch pricing", exact: true })).toHaveCount(0);
});
