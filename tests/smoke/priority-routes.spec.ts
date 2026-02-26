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

test.describe("Smoke | Rotas Prioritarias", () => {
  for (const route of PRIORITY_ROUTES) {
    test(`${route.label} (${route.path}) responde sem erro 5xx`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

      expect(response, `Sem resposta ao abrir ${route.path}`).not.toBeNull();

      const status = response?.status() ?? 0;
      expect(status, `Rota ${route.path} retornou status inesperado`).toBeLessThan(500);

      await expect(page.locator("body")).toBeVisible();
    });
  }
});
