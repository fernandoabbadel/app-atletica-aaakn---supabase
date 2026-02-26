import { expect, test } from "@playwright/test";

const PRIORITY_ROUTES = [
  { label: "Loja", path: "/loja" },
  { label: "Evento", path: "/eventos" },
  { label: "Comunidade", path: "/comunidade" },
  { label: "Parceiros", path: "/parceiros" },
  { label: "Empresa", path: "/empresa" },
  { label: "Planos", path: "/planos" },
  { label: "Cadastro", path: "/cadastro" },
  { label: "Perfil", path: "/perfil" },
  { label: "Ligas", path: "/ligas" },
  { label: "Ligas Unitau", path: "/ligas_unitau" },
  { label: "Admin", path: "/admin" },
  { label: "Album", path: "/album" },
  { label: "Treinos", path: "/treinos" },
  { label: "Conquistas", path: "/conquistas" },
  { label: "Fidelidade", path: "/fidelidade" },
  { label: "Denuncias/Admin Comunidade", path: "/admin/comunidade" },
  { label: "Configuracoes", path: "/admin/configuracoes" },
] as const;

const ACTION_LABEL = /(criar|editar|adicionar|novo|nova)/i;

const collectFatalPageErrors = (page: import("@playwright/test").Page) => {
  const errors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (text.includes("Download the React DevTools") || text.includes("[HMR] connected")) return;
      errors.push(text);
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  return errors;
};

test.describe("Smoke | Botoes de Acao Prioritarios", () => {
  for (const route of PRIORITY_ROUTES) {
    test(`${route.label} (${route.path}) abre CTA criar/editar/adicionar/novo quando existir`, async ({
      page,
    }) => {
      const errors = collectFatalPageErrors(page);

      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
      expect(response, `Sem resposta ao abrir ${route.path}`).not.toBeNull();
      expect(response?.status() ?? 0, `Rota ${route.path} retornou 5xx`).toBeLessThan(500);

      const actionCandidates = page
        .locator('button, a[role="button"], a')
        .filter({ hasText: ACTION_LABEL });

      const count = await actionCandidates.count();
      if (count === 0) {
        await expect(page.locator("body")).toBeVisible();
        expect(errors).toEqual([]);
        return;
      }

      const firstAction = actionCandidates.first();
      await expect(firstAction).toBeVisible({ timeout: 15_000 });
      await firstAction.click({ timeout: 10_000 });

      await expect(page.locator("body")).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
});
