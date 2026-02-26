import { expect, test } from "@playwright/test";

const SMOKE_ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL?.trim() || "";
const SMOKE_ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD?.trim() || "";
const SMOKE_APP_EMAIL = process.env.SMOKE_APP_EMAIL?.trim() || "";
const SMOKE_APP_PASSWORD = process.env.SMOKE_APP_PASSWORD?.trim() || "";
const SMOKE_LIGA_ID = process.env.SMOKE_LIGA_ID?.trim() || "";
const SMOKE_LIGA_PASSWORD = process.env.SMOKE_LIGA_PASSWORD?.trim() || "";

const collectBrowserErrors = (page: import("@playwright/test").Page) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  return {
    getAll: () => [...consoleErrors, ...pageErrors],
  };
};

const isVisibleSafe = async (locator: import("@playwright/test").Locator): Promise<boolean> => {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
};

async function loginLeaguePanelIfNeeded(page: import("@playwright/test").Page): Promise<void> {
  const panelTitle = page.getByText(/Painel de GestÃ£o|Painel de Gest/i);
  if (await isVisibleSafe(panelTitle)) return;

  const ligaSelect = page.locator("select").first();
  await expect(ligaSelect).toBeVisible({ timeout: 20_000 });
  await ligaSelect.selectOption(SMOKE_LIGA_ID);
  await page.locator('input[type="password"]').first().fill(SMOKE_LIGA_PASSWORD);
  await page.getByRole("button", { name: /Acessar Painel/i }).click();
  await expect(panelTitle).toBeVisible({ timeout: 20_000 });
}

async function ensureAdminLigasAccess(page: import("@playwright/test").Page): Promise<void> {
  const novaLigaButton = page.getByRole("button", { name: /Nova Liga/i });

  await page.goto("/admin/ligas", { waitUntil: "domcontentloaded" });
  if (await isVisibleSafe(novaLigaButton)) return;

  const loginButton = page.getByRole("button", { name: /entrar|login|acessar/i }).first();
  const looksLikeLogin =
    /\/(login|entrar|auth|cadastro)(\/|$)/i.test(page.url()) || (await isVisibleSafe(loginButton));

  if (!looksLikeLogin) {
    await page.goto("/admin/ligas", { waitUntil: "networkidle" });
    if (await isVisibleSafe(novaLigaButton)) return;
  }

  test.skip(
    !SMOKE_ADMIN_EMAIL || !SMOKE_ADMIN_PASSWORD,
    "Defina SMOKE_ADMIN_EMAIL e SMOKE_ADMIN_PASSWORD para executar o smoke de criacao em /admin/ligas."
  );

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"], input[name="password"]').first();

  await expect(emailInput).toBeVisible({ timeout: 20_000 });
  await expect(passwordInput).toBeVisible();
  await emailInput.fill(SMOKE_ADMIN_EMAIL);
  await passwordInput.fill(SMOKE_ADMIN_PASSWORD);

  if (await isVisibleSafe(loginButton)) {
    await loginButton.click();
  } else {
    await passwordInput.press("Enter");
  }

  await page.goto("/admin/ligas", { waitUntil: "networkidle" });
  await expect(novaLigaButton).toBeVisible({ timeout: 20_000 });
}

async function ensureLeaguePortalLoginScreen(page: import("@playwright/test").Page): Promise<void> {
  const leagueAccessButton = page.getByRole("button", { name: /Acessar Painel/i });
  const panelTitle = page.getByText(/Painel de GestÃ£o|Painel de Gest/i);
  if (!SMOKE_APP_EMAIL || !SMOKE_APP_PASSWORD) {
    await page.context().addInitScript(() => {
      const fakeUser = {
        uid: `smoke_local_${Date.now()}`,
        nome: "Smoke Tester",
        email: "smoke@test.local",
        foto: "/logo.png",
        role: "user",
        status: "ativo",
        isAnonymous: false,
        plano: "Smoke",
        patente: "Smoke",
        tier: "bicho",
        level: 1,
        xp: 0,
        stats: {},
      };
      window.localStorage.setItem("shark_guest_session", JSON.stringify(fakeUser));
    });
  }

  await page.goto("/ligas", { waitUntil: "domcontentloaded" });

  if ((await isVisibleSafe(leagueAccessButton)) || (await isVisibleSafe(panelTitle))) return;

  const appLoginButton = page.getByRole("button", { name: /Entrar no Cardume/i });
  if (await isVisibleSafe(appLoginButton)) {
    if (SMOKE_APP_EMAIL && SMOKE_APP_PASSWORD) {
      const emailInput = page.getByPlaceholder(/email/i).first();
      const passwordInput = page.locator('input[type="password"]').first();
      await expect(emailInput).toBeVisible({ timeout: 20_000 });
      await expect(passwordInput).toBeVisible();
      await emailInput.fill(SMOKE_APP_EMAIL);
      await passwordInput.fill(SMOKE_APP_PASSWORD);
      await appLoginButton.click();
      await page.goto("/ligas", { waitUntil: "domcontentloaded" });
      if (!(await isVisibleSafe(leagueAccessButton))) {
        await expect(panelTitle).toBeVisible({ timeout: 20_000 });
      }
      return;
    }

    await page.waitForTimeout(1500);
    await page.goto("/ligas", { waitUntil: "networkidle" });
    if (!(await isVisibleSafe(leagueAccessButton))) {
      await expect(panelTitle).toBeVisible({ timeout: 20_000 });
    }
    return;
  }

  await page.goto("/ligas", { waitUntil: "networkidle" });
  if ((await isVisibleSafe(leagueAccessButton)) || (await isVisibleSafe(panelTitle))) return;
  await expect(leagueAccessButton).toBeVisible({ timeout: 20_000 });
}

test.describe("Smoke | Ligas", () => {
  test("rota publica /ligas responde 200 e renderiza", async ({ page }) => {
    const errors = collectBrowserErrors(page);

    const response = await page.goto("/ligas", { waitUntil: "domcontentloaded" });
    expect(response, "Resposta da rota /ligas deve existir").not.toBeNull();
    expect(response?.status()).toBe(200);

    await expect(page.locator("body")).toBeVisible();
    await Promise.race([
      page.getByText(/Portal das Ligas|Selecione sua Liga/i).first().waitFor({ state: "visible", timeout: 15_000 }),
      page.getByText(/CARREGANDO/i).first().waitFor({ state: "visible", timeout: 15_000 }),
    ]);

    const fatalErrors = errors.getAll().filter((entry) => !entry.includes("Download the React DevTools"));
    expect(fatalErrors).toEqual([]);
  });

  test("admin /admin/ligas cria nova liga sem erro de gravacao", async ({ page }) => {
    const errors = collectBrowserErrors(page);
    const uniqueSuffix = Date.now().toString().slice(-6);
    const nomeLiga = `Smoke Liga ${uniqueSuffix}`;
    const sigla = `S${uniqueSuffix.slice(-5)}`.slice(0, 6).toUpperCase();

    await ensureAdminLigasAccess(page);

    await page.getByRole("button", { name: /Nova Liga/i }).click();
    await expect(page.getByRole("heading", { name: /Nova Liga/i })).toBeVisible();

    await page.getByPlaceholder("Nome da Liga").fill(nomeLiga);
    await page.getByPlaceholder("Sigla").fill(sigla);
    await page.getByPlaceholder("Presidente").fill("Smoke Bot");
    await page.getByPlaceholder("Senha de Acesso").fill(`smoke-${uniqueSuffix}`);

    const writeResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/rest/v1/ligas_config") &&
        response.request().method() === "POST"
    );

    await page.getByRole("button", { name: /Salvar Tudo/i }).click();

    const writeResponse = await writeResponsePromise;
    expect(writeResponse.status()).toBeLessThan(400);

    // O ToastContext atual tem titulo randomico; validamos a mensagem da tela.
    await expect(page.getByText(/Liga criada!/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Erro ao salvar\\./i)).toHaveCount(0);

    const fatalErrors = errors.getAll().filter(
      (entry) => !entry.includes("Download the React DevTools") && !entry.includes("[HMR] connected")
    );
    expect(fatalErrors).toEqual([]);
  });

  test("portal /ligas preserva rascunho de evento apos reload", async ({ page }) => {
    test.skip(
      !SMOKE_LIGA_ID || !SMOKE_LIGA_PASSWORD,
      "Defina SMOKE_LIGA_ID e SMOKE_LIGA_PASSWORD para validar rascunho do portal /ligas."
    );

    const draftTitle = `Evento Smoke ${Date.now().toString().slice(-6)}`;
    const draftLocal = "Quadra Central";
    const draftDescricao = "Rascunho para validar persistencia apos reload.";
    const errors = collectBrowserErrors(page);

    await ensureLeaguePortalLoginScreen(page);

    await loginLeaguePanelIfNeeded(page);

    await expect(page.getByText(/Painel de Gestão|Painel de Gest/i)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /^3\.\s*Eventos$/i }).click();
    await page.getByRole("button", { name: /Criar Evento/i }).click();

    await expect(page.getByRole("heading", { name: /Evento da Liga/i })).toBeVisible();

    const titleInput = page.locator('input[placeholder*="Evento"]').first();
    const localInput = page.getByPlaceholder("Local");
    const descricaoInput = page.locator("textarea").first();

    await titleInput.fill(draftTitle);
    await page.locator('input[type="date"]').first().fill("2026-03-15");
    await page.locator('input[type="time"]').first().fill("20:00");
    await localInput.fill(draftLocal);
    await descricaoInput.fill(draftDescricao);

    await page.reload({ waitUntil: "domcontentloaded" });
    await ensureLeaguePortalLoginScreen(page);
    await loginLeaguePanelIfNeeded(page);

    await expect(page.getByText(/Painel de Gestão|Painel de Gest/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Rascunho recuperado/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /Evento da Liga/i })).toBeVisible({ timeout: 20_000 });

    await expect(page.locator('input[placeholder*="Evento"]').first()).toHaveValue(draftTitle);
    await expect(page.getByPlaceholder("Local")).toHaveValue(draftLocal);
    await expect(page.locator("textarea").first()).toHaveValue(draftDescricao);

    await page.getByRole("button", { name: /Salvar Evento/i }).click();
    await expect(page.getByText(/Evento salvo no rascunho/i)).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /SALVAR TUDO/i }).click();
    await expect(page.getByText(/Salvo e Sincronizado!/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Erro ao salvar\\./i)).toHaveCount(0);

    const fatalErrors = errors.getAll().filter(
      (entry) =>
        !entry.includes("Download the React DevTools") &&
        !entry.includes("[HMR] connected") &&
        !entry.includes("content.js") &&
        !entry.includes("content-all.js")
    );
    expect(
      fatalErrors.some((entry) => entry.includes("doc(collectionRef, id) exige exatamente um id.")),
      `Erro de auto-id nao deve reaparecer. Errors: ${fatalErrors.join(" | ")}`
    ).toBe(false);
  });
});
