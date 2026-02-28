# Auditoria de Consistencia de Plano

Data: 2026-02-28
Escopo: campos de plano no app + sincronizacao com snapshots + validacao de build.

## Resultado Final
- `npm run build`: OK (sem erros)
- Consistencia no banco (`users` vs `planos` e snapshots): `0|0|0|0`
  - ordem: `user_mismatch|event_comment_mismatch|post_mismatch|post_comment_mismatch`

## Correcoes Aplicadas Nesta Rodada

1. Defaults de plano alinhados com o catalogo (`Bicho Solto -> ghost/zinc`, prioridade 1)
- `src/constants/userDefaults.ts:47` `plano_cor: "zinc"`
- `src/constants/userDefaults.ts:50` `nivel_prioridade: 1`
- `src/utils/repairUser.ts:19` `plano_cor: "zinc"`
- `src/utils/repairUser.ts:22` `nivel_prioridade: 1`

2. AuthContext passou a sincronizar tambem `nivel_prioridade` com `public.planos`
- `src/context/AuthContext.tsx:28` `PlanoConfig` inclui `nivelPrioridade`
- `src/context/AuthContext.tsx:119` `User` inclui `nivel_prioridade?`
- `src/context/AuthContext.tsx:457` leitura de planos inclui `nivelPrioridade`
- `src/context/AuthContext.tsx:469` mapeamento de cache com `nivelPrioridade`
- `src/context/AuthContext.tsx:778` fallback de `nivel_prioridade` no bloco de autocura
- `src/context/AuthContext.tsx:788` fallback quando usuario nao tem `nivel_prioridade`
- `src/context/AuthContext.tsx:861` reconciliacao de plano aprovado escreve `nivel_prioridade`
- `src/context/AuthContext.tsx:887` compara `currentPriority`
- `src/context/AuthContext.tsx:900` sincroniza `updates.nivel_prioridade`

3. Tipagem de `tier` ampliada para refletir estados reais
- `src/types/user.ts:64` `tier: "bicho" | "cardume" | "atleta" | "lenda" | "veterano"`

## Pontos Criticos de Renderizacao (Plano Icon)
- `src/app/components/BottomNav.tsx:68`
- `src/app/perfil/page.tsx:169`
- `src/app/perfil/[id]/page.tsx:163`
- `src/app/comunidade/page.tsx:138`
- `src/app/carteirinha/page.tsx:64`
- `src/app/eventos/[id]/page.tsx:203`

Todos acima estao com resolucao de icone usando fallback `Ghost`/`ghost` para evitar icone inventado quando dado vier vazio.

## Caminhos de Escrita em Massa (Sincronizacao de Snapshots)
- `src/lib/plansService.ts:232` `syncPlanVisualSnapshotsForUser`
- `src/lib/plansService.ts:984` `completeUserPatch`
- `src/lib/plansService.ts:987-993` patch de `plano_*`, `tier`, `xpMultiplier`, `nivel_prioridade`, `desconto_loja`
- `supabase/migrations/20260228000200_backfill_users_plan_visuals.sql:15`
- `supabase/migrations/20260228000200_backfill_users_plan_visuals.sql:28`
- `supabase/migrations/20260228000200_backfill_users_plan_visuals.sql:41`
- `supabase/migrations/20260228000200_backfill_users_plan_visuals.sql:54`

## Regras de Varredura Sem Ocorrencia
- fallback legado `plano_cor: "gray"` em defaults ativos
- `nivel_prioridade: 0` em defaults ativos
- `resolveUserPlanIcon(..., User)` nas telas principais de plano/perfil

## Observacao
Warnings de lint restantes existem, mas nao sao de consistencia de plano e nao bloqueiam o build.
