import { expect, test, type Page } from "playwright/test";

const models = {
  default_model_id: "deterministic/rules-v1",
  models: [{
    id: "deterministic/rules-v1",
    provider: "deterministic",
    model: "rules-v1",
    label: "Deterministic rules",
    location: "local",
    best_for: "Fast tests",
    available: true,
  }],
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Credentials": "true",
};
const workspace = {
  id: "workspace-1",
  name: "Personal workspace",
  account_id: "account-1",
  account_name: "Demo User",
  mode: "local_personal",
  created_at: "2026-08-28T00:00:00Z",
};

async function mockBootstrap(page: Page, decisions: unknown[] = [], activeWorkspace = workspace) {
  await page.route(/\/v1\/bootstrap(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: {
    models,
    workspace: activeWorkspace,
    library: { items: decisions, total: decisions.length },
  } }));
  await page.route(/\/v1\/models(?:\?.*)?$/, (route) => route.fulfill({ json: models, headers: corsHeaders }));
  await page.route(/\/v1\/workspace(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: activeWorkspace }));
  await page.route(/\/v1\/decisions(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: { items: decisions, total: decisions.length } }));
}

test("executes the workspace bootstrap preload without syntax or hydration errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockBootstrap(page);

  await page.goto("/workspace");

  await expect(page.getByRole("heading", { name: "Bring in a decision" })).toBeVisible();
  expect(pageErrors.filter((message) => /Invalid regular expression|hydration|Minified React error #418/i.test(message))).toEqual([]);
});

test("links the workspace brand back to the landing page", async ({ page }) => {
  await mockBootstrap(page);
  await page.goto("/workspace");

  const homeLink = page.getByRole("link", { name: "Rationexa home" });
  await expect(homeLink).toHaveAttribute("href", "/");
  await homeLink.click();
  await expect(page).toHaveURL(/\/$/);
});

test("gives the decision content more room than the workflow rail on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await mockBootstrap(page);
  await page.goto("/workspace");

  const workflowWidth = await page.locator(".workflow-pane").evaluate((element) => element.getBoundingClientRect().width);
  const workspaceWidth = await page.locator(".workspace").evaluate((element) => element.getBoundingClientRect().width);

  expect(workflowWidth).toBeLessThanOrEqual(262);
  expect(workspaceWidth).toBeGreaterThan(1000);
});

test("keeps the import stage legible in dark mode", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await mockBootstrap(page);
  await page.route(/\/v1\/account-settings(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: {
    authenticated: true,
    account: { id: "account-1", name: "Demo User", email: "reviewer@example.com", has_password: true, created_at: "2026-08-28T00:00:00Z" },
    workspace: { ...workspace, mode: "authenticated_personal" },
    sessions: [{ id: "session-1", current: true, created_at: "2026-08-28T00:00:00Z", expires_at: "2026-09-28T00:00:00Z" }],
    secrets: [],
  } }));

  await page.goto("/workspace");

  await expect(page.getByText("Step 1 of 4 · Import")).toBeVisible();
  await expect(page.getByText("Start with the source")).toBeVisible();
  await expect(page.getByText("Decision memory / Import")).toHaveCount(0);
  const stageNumber = page.locator(".stage-number");
  await expect(stageNumber).toHaveCSS("color", "rgb(14, 20, 16)");
  await expect(stageNumber).toHaveCSS("background-color", "rgb(237, 244, 239)");
  await expect(page.getByRole("tab", { name: "Paste text" })).toHaveCSS("background-color", "rgb(21, 29, 24)");
  await expect(page.getByRole("tab", { name: "Paste text" })).toHaveCSS("color", "rgb(237, 244, 239)");
  await expect(page.getByLabel("Decision source")).toHaveCSS("background-color", "rgb(21, 29, 24)");

  await page.getByRole("button", { name: "All decisions" }).click();
  await expect(page.locator(".library-empty")).toHaveCSS("background-color", "rgb(21, 29, 24)");
  await expect(page.locator(".library-empty")).toHaveCSS("color", "rgb(237, 244, 239)");

  await page.getByRole("button", { name: "Account and provider keys" }).click();
  await expect(page.getByLabel("Display name")).toHaveCSS("background-color", "rgb(21, 29, 24)");
  await expect(page.getByLabel("Display name")).toHaveCSS("color", "rgb(237, 244, 239)");
});

test("does not restore another workspace's browser draft", async ({ page }) => {
  const privateWorkspace = {
    ...workspace,
    id: "workspace-b",
    account_id: "account-b",
    account_name: "Reviewer B",
    mode: "authenticated_personal",
  };
  await mockBootstrap(page, [], privateWorkspace);
  await page.addInitScript(() => localStorage.setItem("rationexa-workspace-draft-v1", JSON.stringify({
    workspaceId: "workspace-a",
    source: "Private draft belonging to reviewer A",
    workflowView: 1,
    view: "workspace",
  })));

  await page.goto("/workspace");

  await expect(page.getByLabel("Decision source")).toHaveValue("");
  await expect(page.getByText("Private draft belonging to reviewer A")).toHaveCount(0);
});

test("keeps an unfinished decision available after visiting the library", async ({ page }) => {
  await mockBootstrap(page);
  await page.goto("/workspace");
  await page.getByLabel("Decision source").fill("Draft decision that still needs review");

  await page.getByRole("button", { name: "All decisions" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("button", { name: /Continue current draft/ })).toBeVisible();
  await page.getByRole("button", { name: /Continue current draft/ }).click();

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByLabel("Decision source")).toHaveValue("Draft decision that still needs review");
});

test("switches import modes and opens the shadcn model picker", async ({ page }) => {
  await mockBootstrap(page);
  await page.goto("/workspace");

  await page.getByRole("tab", { name: "Upload file" }).click();
  await expect(page.getByLabel("Decision file")).toBeVisible();
  await expect(page.getByLabel("Decision source")).toHaveCount(0);

  await page.getByRole("tab", { name: "Paste text" }).click();
  await expect(page.getByLabel("Decision source")).toBeVisible();

  await page.getByRole("button", { name: /Extraction model:/ }).click();
  await expect(page.getByRole("listbox", { name: "Available AI models" })).toBeVisible();
  await page.getByRole("button", { name: "Close model menu" }).click();
  await expect(page.getByRole("listbox", { name: "Available AI models" })).toHaveCount(0);
});

test("keeps extraction progress inside the import card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockBootstrap(page);
  await page.route(/\/v1\/artifacts(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: { id: "artifact-1" } }));
  let releaseExtraction!: () => void;
  const extractionGate = new Promise<void>((resolve) => { releaseExtraction = resolve; });
  await page.route(/\/v1\/decisions\/extractions\/jobs(?:\?.*)?$/, async (route) => {
    await extractionGate;
    await route.fulfill({ status: 500, headers: corsHeaders, json: { detail: "Test completed" } });
  });
  await page.goto("/workspace");
  await page.getByLabel("Decision source").fill("Decision context for an extraction progress layout test.");
  await page.getByRole("button", { name: "Extract decision" }).click();

  const progressButton = page.getByRole("button", { name: "Extracting with Deterministic rules" });
  await expect(progressButton).toContainText("Extracting…");
  const panelBox = await page.locator(".import-source-panel").boundingBox();
  const buttonBox = await progressButton.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePanelBox = await page.locator(".import-source-panel").boundingBox();
  const mobileButtonBox = await progressButton.boundingBox();
  expect(mobilePanelBox).not.toBeNull();
  expect(mobileButtonBox).not.toBeNull();
  expect(mobileButtonBox!.x).toBeGreaterThanOrEqual(mobilePanelBox!.x - 1);
  expect(mobileButtonBox!.x + mobileButtonBox!.width).toBeLessThanOrEqual(mobilePanelBox!.x + mobilePanelBox!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  releaseExtraction();
  await expect(progressButton).toHaveCount(0);
});

test("uses clean paths for workspace sections", async ({ page }) => {
  await mockBootstrap(page);
  await page.route(/\/v1\/account(?:\?.*)?$/, (route) => route.fulfill({ status: 401, headers: corsHeaders, json: { detail: "Not authenticated" } }));
  await page.goto("/library");

  await expect(page).toHaveURL(/\/library$/);
  await page.getByRole("button", { name: "Usage and cost" }).click();
  await expect(page).toHaveURL(/\/usage$/);
  await page.getByRole("button", { name: "Account and provider keys" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.url()).not.toContain("#");
});

test("opens collapsed navigation only after an explicit click", async ({ page }) => {
  await mockBootstrap(page);
  await page.goto("/workspace");

  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await page.mouse.move(1, 320);
  await expect(page.getByRole("button", { name: "All decisions" })).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "All decisions" })).toBeVisible();
});

test("uses an explicit navigation drawer on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBootstrap(page);
  await page.goto("/workspace");

  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Account and provider keys" })).toBeVisible();
  await page.getByRole("button", { name: "Close navigation" }).click({ position: { x: 360, y: 400 } });
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await expect(page.getByLabel("Decision source")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("keeps mobile workflow navigation pinned and gives locked steps feedback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBootstrap(page);
  await page.goto("/workspace");

  const workflow = page.locator(".workflow-pane");
  const initialTop = await workflow.evaluate((element) => element.getBoundingClientRect().top);
  await page.locator(".workspace").evaluate((element) => { element.scrollTop = 700; });
  const scrolledTop = await workflow.evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.abs(scrolledTop - initialTop)).toBeLessThanOrEqual(1);

  const reviewStep = page.getByRole("button", { name: "Review (locked)" });
  await expect(reviewStep).toBeEnabled();
  await expect(reviewStep).toHaveAttribute("data-locked", "true");
  await reviewStep.click();
  await expect(page.getByText("Complete Import to unlock this step")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import" })).toHaveAttribute("aria-current", "step");
});

test("keeps a clean password-reset URL available while signed out", async ({ page }) => {
  await page.route(/\/v1\/bootstrap(?:\?.*)?$/, (route) => route.fulfill({ status: 401, headers: corsHeaders, json: { detail: "Sign in required" } }));
  await page.route(/\/v1\/account(?:\?.*)?$/, (route) => route.fulfill({ status: 401, headers: corsHeaders, json: { detail: "Not authenticated" } }));
  await page.route(/\/v1\/workspace(?:\?.*)?$/, (route) => route.fulfill({ status: 401, headers: corsHeaders, json: { detail: "Not authenticated" } }));
  await page.goto("/account/reset?token=clean-reset-token");

  await expect(page).toHaveURL(/\/account\/reset\?token=clean-reset-token$/);
  await expect(page.getByLabel("One-time reset token")).toHaveValue("clean-reset-token");
  await expect(page.url()).not.toContain("#");
});

test("offers password recovery directly from sign in", async ({ page }) => {
  const guestWorkspace = { ...workspace, id: "guest-workspace", account_id: "guest-account", account_name: "Guest reviewer", mode: "guest_personal" };
  await mockBootstrap(page, [], guestWorkspace);
  await page.route(/\/v1\/account-settings(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: {
    authenticated: false,
    account: { id: "guest-account", name: "Guest reviewer", email: null, has_password: false, created_at: "2026-08-28T00:00:00Z" },
    workspace: guestWorkspace,
    sessions: [],
    secrets: [],
  } }));
  await page.route(/\/v1\/auth\/password-reset\/request$/, (route) => route.fulfill({ headers: corsHeaders, json: {
    message: "If that account exists, a password reset link has been prepared.",
  } }));
  await page.goto("/settings");

  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByText("Reset your password", { exact: true })).toBeVisible();
  await page.getByLabel("Email").fill("reviewer@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Check your email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to sign in" })).toBeVisible();
});

test("clears a deleted decision from restored workspace state", async ({ page }) => {
  await mockBootstrap(page);
  await page.route(/\/v1\/decisions\/deleted-decision$/, (route) => route.fulfill({ status: 404, headers: corsHeaders, json: { detail: "Decision not found" } }));
  await page.route(/\/v1\/decisions\/deleted-decision\/revisit-checks$/, (route) => route.fulfill({ status: 404, headers: corsHeaders, json: { detail: "Decision not found" } }));
  await page.addInitScript(() => localStorage.setItem("rationexa-workspace-draft-v1", JSON.stringify({ decisionId: "deleted-decision", workflowView: 4, view: "workspace" })));

  await page.goto("/workspace");

  await expect(page.getByRole("heading", { name: "Decision library" })).toBeVisible();
  await expect(page.getByText("The deleted decision was removed from your restored workspace")).toBeVisible();
  await expect(page.locator(".error")).toHaveCount(0);
});

test("delete confirmation stays visible and can be cancelled", async ({ page }) => {
  const decision = {
    id: "decision-1",
    title: "Architecture decision",
    question: "Which architecture should we use?",
    criticality: "important",
    status: "decision_ready",
    premise_count: 2,
    revisit_count: 0,
    pending_revisit_count: 0,
    created_at: "2026-08-28T00:00:00Z",
  };
  await mockBootstrap(page, [decision]);
  await page.goto("/workspace");
  await page.getByRole("button", { name: "All decisions" }).click();
  await page.getByRole("button", { name: "Delete Architecture decision" }).click();

  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delete this decision?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("unavailable models explain the problem and block extraction", async ({ page }) => {
  const unavailableModels = {
    default_model_id: "ollama/missing:latest",
    models: [{
      id: "ollama/missing:latest",
      provider: "ollama",
      model: "missing:latest",
      label: "Missing model",
      location: "local",
      best_for: "Local reasoning",
      available: false,
      availability_reason: "Not installed. Run `ollama pull missing:latest`.",
    }],
  };
  await page.route(/\/v1\/bootstrap(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: {
    models: unavailableModels,
    workspace,
    library: { items: [], total: 0 },
  } }));
  await page.route(/\/v1\/models(?:\?.*)?$/, (route) => route.fulfill({ json: unavailableModels, headers: corsHeaders }));
  await page.route(/\/v1\/workspace(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: workspace }));
  await page.route(/\/v1\/decisions(?:\?.*)?$/, (route) => route.fulfill({ headers: corsHeaders, json: { items: [], total: 0 } }));

  await page.goto("/workspace");
  await page.getByLabel("Decision source").fill("We decided to use the pilot architecture.");

  await expect(page.getByText("Not installed. Run `ollama pull missing:latest`.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Extract decision →" })).toBeDisabled();
});
