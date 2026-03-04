# AGENTS.md

## Visão Geral
- Projeto Next.js 15 (App Router) com TypeScript `strict`.
- Build usa `next build` e valida lint/TS via `next/core-web-vitals` + `next/typescript`.

## Arquitetura (pastas e responsabilidades)
- `src/app/`: rotas/telas (App Router), incluindo `admin/` e páginas públicas.
- `src/context/`: contextos React (ex.: toasts).
- `src/lib/`: integrações e infraestrutura (ex.: Supabase).
- `src/hooks/`: hooks compartilhados.
- `src/utils/`: utilitários.
- `src/types/`: tipagens compartilhadas.
- `src/constants/`: constantes de domínio/UX.
- `public/`: assets estáticos.

## Padrões de Tipagem
- Evitar `any`. Preferir `unknown` + narrowing (`instanceof Error`, `typeof`, etc.).
- Em eventos React, usar tipos específicos (ex.: `React.ChangeEvent<HTMLInputElement>`).
- Se um parâmetro não é usado, remover ou usar convenção `_param`.
- Em `catch`, usar `catch (err: unknown)` se for usar o erro, ou `catch {}` se não for necessário.

## Convenções do Projeto
- Mudanças mínimas e rastreáveis.
- Não desabilitar regras de ESLint/TS como atalho.
- Sem novas dependências sem confirmação explícita.

## Rotas/Telas Principais (exemplos)
- Admin: `src/app/admin/*` (configurações, eventos, jogos, usuários, etc.).
- Público: `src/app/games`, `src/app/eventos`, `src/app/loja`, `src/app/planos`, `src/app/treinos`, `src/app/perfil`, `src/app/comunidade`, `src/app/ligas`.
- Dinâmicas: `src/app/**/[id]/page.tsx` e subrotas.

## Decisões Recentes
- 2026-02-05: iniciar correções de lint/TS para fazer `npm run build` passar, mantendo mudanças mínimas.
- 2026-02-05: mover cálculos de games para `src/lib/games.ts` para evitar exports nomeados em `src/app/**/page.tsx`.

- 2026-02-05: substituir `<img>` por `<Image>` em páginas públicas/admin (ligas, ligas_unitau, menu, not-found, loja, gym, gym/checkin/details, loading) usando `unoptimized` quando a origem é base64/remota.
- 2026-02-05: pendente aprovação para adicionar domínios de imagens externas em `next.config.ts` (placehold.co, via.placeholder.com, www.svgrepo.com, api.dicebear.com).
