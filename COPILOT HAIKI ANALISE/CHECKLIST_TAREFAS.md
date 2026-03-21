# ✅ Checklist de Tarefas - Otimização Supabase

> Copie cada task para seu sistema de tracking (Jira, GitHub Projects, Linear, etc.)

---

## 🔴 SPRINT 1: CRITICAL (5 horas total)

### TASK-001: Reduzir Dashboard Events 40→5
**Descrição**: Limitar eventos na landing page de 40 para 5 e remover colunas desnecessárias.

**Arquivo**: `src/lib/dashboardPublicService.ts`

**Mudanças Necessárias**:
- [ ] Mudar `DASHBOARD_EVENTS_FETCH_LIMIT` de 40 para 5
- [ ] Remover colunas: `imagePositionY`, `likesList`, `interessados` do SELECT
- [ ] Teste: Landing page carrega em < 2s
- [ ] Teste: Visualmente sem mudanças perceptíveis

**Estimativa**: 30 minutos  
**Prioridade**: 🔴 CRÍTICO  
**Impacto**: -30% egress total

**Referência**: 
- Ver: `REFERENCIA_TECNICA.md` § Exemplo 1
- Follow: `PLANO_ACAO_OTIMIZACAO.md` § Task 1.1

**Checklist**:
- [ ] Código alterado
- [ ] Build passa (`npm run build`)
- [ ] Lint passa (`npm run lint`)
- [ ] TypeScript OK (`npx tsc`)
- [ ] Teste manual no browser
- [ ] Sem console errors
- [ ] PR criado com link à análise

---

### TASK-002: Remove Base64 Images do SELECT
**Descrição**: Removendo logos e imagens em base64 de todos os SELECT statements.

**Arquivos**:
- `src/lib/dashboardPublicService.ts` (DASHBOARD_LIGAS_SELECT)
- `src/lib/leaguesService.ts` (LEAGUES_SELECT_COLUMNS)
- `src/lib/storeService.ts` (produto images)
- Localizar todas refs a `logoBase64` via: `rg -l "logoBase64" src/`

**Mudanças Necessárias**:
- [ ] Remove `logoBase64` de TODOS os SELECT statements
- [ ] Remover colunas base64 não-essenciais
- [ ] Se logoBase64 precisar: criar lazy-load query separada
- [ ] Update componentes UI para suportar lazy load (opcional)

**Estimativa**: 1 hora  
**Prioridade**: 🔴 CRÍTICO  
**Impacto**: -15% egress total

**Referência**:
- Ver: `REFERENCIA_TECNICA.md` § Exemplo 2
- Follow: `PLANO_ACAO_OTIMIZACAO.md` § Task 1.2

**Checklist**:
- [ ] Código alterado em 3+ arquivos
- [ ] Nenhum `logoBase64` em SELECT defaults
- [ ] Build passa
- [ ] Lint passa
- [ ] Images ainda carregam via URL
- [ ] Teste ligas page
- [ ] Teste store page
- [ ] PR criado

---

### TASK-003: Aumentar Cache TTL & Add Revalidate
**Descrição**: Mudar cache de 30s para 300s e adicionar ISR revalidation em rotas públicas.

**Arquivos**:
- `src/lib/dashboardPublicService.ts` (TTL)
- `src/lib/leaguesService.ts` (TTL)
- `src/lib/rankingService.ts` (TTL)
- `src/app/api/public/landing/route.ts` (revalidate)
- `src/app/api/public/tenants/route.ts` (revalidate)

**Mudanças Necessárias**:
- [ ] `READ_CACHE_TTL_MS`: 30_000 → 300_000 (em todos 3 services)
- [ ] `const TTL_MS`: 25_000 → 300_000 (ranking service)
- [ ] Add `export const revalidate = 300` em rotas públicas
- [ ] Verificar que Next.js App Router está ativo

**Estimativa**: 30 minutos  
**Prioridade**: 🔴 CRÍTICO  
**Impacto**: -20% egress total

**Referência**:
- Ver: `REFERENCIA_TECNICA.md` § Exemplo 3
- Follow: `PLANO_ACAO_OTIMIZACAO.md` § Task 1.3

**Checklist**:
- [ ] TTL mudado em dashboardPublicService
- [ ] TTL mudado em leaguesService  
- [ ] TTL mudado em rankingService
- [ ] revalidate adicionado em landing route
- [ ] revalidate adicionado em tenants route
- [ ] Build passa
- [ ] Lint passa
- [ ] PR criado

---

### TASK-004: Paginar Store Orders (1200→20 per page)
**Descrição**: Implementar cursor-based pagination para store orders, reduzindo de 1200 para 20 por página.

**Arquivos**:
- `src/lib/storeService.ts` - NEW function `fetchStoreOrdersPage()`
- Componentes que usam `fetchStoreOrders()` - UPDATE para usar `fetchStoreOrdersPage()`

**Mudanças Necessárias**:
- [ ] Add interface `StorePaginationCursor`
- [ ] Add function `fetchStoreOrdersPage()` com cursor logic
- [ ] Reduce SELECT columns de 13 para 6 essenciais
- [ ] Update MAX_ORDERS: 1200 → 20 (ou deixar como DEPRECATED)
- [ ] Update componentes UI para "Load More" button
- [ ] Test pagination: primeira página OK, load more OK

**Estimativa**: 2 horas  
**Prioridade**: 🔴 CRÍTICO  
**Impacto**: -12% egress total

**Referência**:
- Ver: `REFERENCIA_TECNICA.md` § Exemplo 4
- Follow: `PLANO_ACAO_OTIMIZACAO.md` § Task 1.4

**Checklist**:
- [ ] Pagination function criada
- [ ] Interface de cursor definida
- [ ] Componentes atualizados (if any)
- [ ] First page carrega < 1s
- [ ] "Load more" funciona
- [ ] Build passa
- [ ] Lint passa
- [ ] UI test: 5+ orders visíveis na página
- [ ] Cursor test: Load more pega próximas 20
- [ ] PR criado

---

### TASK-005: Add Rate Limiting Middleware
**Descrição**: Implementar rate limiting por IP para proteger endpoints públicos.

**Arquivos (NEW)**:
- `src/lib/rateLimiter.ts` - CRIAR
- `src/middleware.ts` - CREATE ou UPDATE

**Mudanças Necessárias**:
- [ ] Create `rateLimiter.ts` com função `isRateLimited()`
- [ ] Create/Update `middleware.ts` com rate limit check
- [ ] Proteger `/api/public/*` com 30-60 req/min limit
- [ ] Return 429 Too Many Requests quando limite atingido
- [ ] Add cleanup logic para evitar memory leak
- [ ] Test: 35 requests em 1 minuto deve bloquear > 30

**Estimativa**: 1 hora  
**Prioridade**: 🔴 CRÍTICO  
**Impacto**: -100% bot abuse (preventivo)

**Referência**:
- Ver: `REFERENCIA_TECNICA.md` § Exemplo 5
- Follow: `PLANO_ACAO_OTIMIZACAO.md` § Task 1.5

**Checklist**:
- [ ] rateLimiter.ts criado
- [ ] middleware.ts criado/atualizado
- [ ] Limites definidos por endpoint
- [ ] 429 status code retornado
- [ ] Build passa
- [ ] Lint passa
- [ ] Manual test: `for i in {1..35}; do curl http://localhost:3000/api/public/landing; done`
- [ ] Requests 1-30 = 200 OK
- [ ] Requests 31+ = 429 Too Many Requests
- [ ] PR criado

---

### ✅ SPRINT 1 COMPLETE Checklist
- [ ] TASK-001 done
- [ ] TASK-002 done
- [ ] TASK-003 done
- [ ] TASK-004 done
- [ ] TASK-005 done
- [ ] All PRs reviewed & merged
- [ ] Metrics measured vs baseline
- [ ] No new bugs reported
- [ ] Team informed of changes

**Expected Result**: -75% egress, landing page 5MB→500KB, store orders 50MB→840KB

---

## 🟡 SPRINT 2: HIGH (4 horas total)

### TASK-201: Cleanup Realtime Subscriptions
**Descrição**: Fix memory leaks em realtime subscriptions adicionando `.unsubscribe()` em cleanup.

**Arquivos**: 
- Procurar com: `rg -A 10 "\.on\(" src/ --type ts --type tsx`
- Arquivos-chave:
  - `src/context/AuthContext.tsx`
  - `src/app/comunidade/*`
  - `src/app/sharkround/*`

**Mudanças Necessárias**:
- [ ] Find all `.on()` calls in useEffect
- [ ] Add cleanup function: `return () => { channel.unsubscribe(); supabase.removeChannel(channel); }`
- [ ] Test: DevTools Memory → detached DOM nodes não crescem

**Estimativa**: 2 horas  
**Prioridade**: 🟡 ALTA  
**Impacto**: Prevenir connection leaks

**Checklist**:
- [ ] Todas subscriptions com cleanup
- [ ] Build passa
- [ ] No console warnings
- [ ] DevTools shows no detached nodes
- [ ] 1h game/usage sem memory leak
- [ ] PR criado

---

### TASK-202: Batch User Stats Updates com RPC
**Descrição**: Usar Postgres RPC para incrementar stats em 1 query ao invés de 2.

**Arquivos**:
- `src/lib/supabaseData.ts` - UPDATE `incrementUserStats()`
- `docs/supabase_optimization.sql` - CREATE function

**SQL Change**:
```sql
CREATE OR REPLACE FUNCTION increment_user_stats(
    user_id TEXT,
    stat_deltas JSONB
) RETURNS void AS $$
BEGIN
    UPDATE users
    SET stats = COALESCE(stats, '{}'::jsonb) || stat_deltas,
        "updatedAt" = NOW()
    WHERE uid = user_id;
END;
$$ LANGUAGE plpgsql;
```

**Code Change**:
- [ ] Replace 2-query pattern com single RPC call
- [ ] Test: Stats incrementam corretamente

**Estimativa**: 2 horas  
**Prioridade**: 🟡 ALTA  
**Impacto**: -50% stats queries

**Checklist**:
- [ ] RPC function criada (executado em Supabase)
- [ ] Código atualizado
- [ ] Build passa
- [ ] Stats still increment corretamente
- [ ] Performance baseline: antes/depois
- [ ] PR criado

---

### ✅ SPRINT 2 COMPLETE Checklist
- [ ] TASK-201 done
- [ ] TASK-202 done
- [ ] All connections healthy
- [ ] No memory leaks detected
- [ ] Performance stable

---

## 🟢 SPRINT 3: MEDIUM (3 horas total) - Optional

### TASK-301: Add Database Indexes
**Descrição**: Criar índices para queries frequentes.

**File**: `docs/supabase_optimization.sql`

**SQL**:
```sql
CREATE INDEX IF NOT EXISTS idx_users_tenant_xp 
ON users(tenant_id, xp DESC) WHERE status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_eventos_data 
ON eventos(data DESC) WHERE status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_ligas_tenant_status
ON ligas_config(tenant_id, ativa) WHERE visivel = true;

CREATE INDEX IF NOT EXISTS idx_orders_user_date
ON orders(userId, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_users_turma_xp
ON users(turma, xp DESC) WHERE status = 'ativo';
```

**Estimativa**: 1 hora  
**Prioridade**: 🟢 MÉDIA  
**Impacto**: Query speed +30%

**Checklist**:
- [ ] SQL executado via Supabase editor
- [ ] Índices criados sem errors
- [ ] Query performance melhorou

---

### TASK-302: Archive Old Notifications
**Descrição**: Move notificações antigas (>6 meses) para tabela archive.

**SQL**:
```sql
CREATE TABLE notifications_archive (LIKE notifications INCLUDING ALL);

BEGIN;
INSERT INTO notifications_archive 
SELECT * FROM notifications WHERE created_at < NOW() - INTERVAL '6 months';

DELETE FROM notifications
WHERE created_at < NOW() - INTERVAL '6 months';

COMMIT;
```

**Estimativa**: 2 horas  
**Prioridade**: 🟢 MÉDIA  
**Impacto**: Table size -30%

**Checklist**:
- [ ] Archive table criada
- [ ] Old data movido
- [ ] Original table mais limpo
- [ ] Queries mais rápidas

---

### ✅ SPRINT 3 COMPLETE Checklist
- [ ] TASK-301 done
- [ ] TASK-302 done
- [ ] Database performance +30%
- [ ] Tables cleaned up

---

## 📊 Progress Tracking Template

```
SPRINT 1 (CRITICAL - 5h)
├─ TASK-001 [████████░░] 80% - In Review
├─ TASK-002 [██████░░░░] 60% - In Progress (Dev2)
├─ TASK-003 [██████████] 100% ✅ - Merged
├─ TASK-004 [████░░░░░░] 40% - In Progress (Dev1)
└─ TASK-005 [░░░░░░░░░░] 0% - To Do

Overall: 36% complete | ETA: +2 days

SPRINT 2 (HIGH - 4h)
├─ TASK-201 [░░░░░░░░░░] 0% - To Do (after Sprint 1)
└─ TASK-202 [░░░░░░░░░░] 0% - To Do (after Sprint 1)

SPRINT 3 (MEDIUM - 3h)
├─ TASK-301 [░░░░░░░░░░] 0% - Backlog
└─ TASK-302 [░░░░░░░░░░] 0% - Backlog
```

---

## 🎯 Success Criteria Template

Para validar completeness de cada sprint:

### Antes de Marcar como DONE:

**Code Quality**:
- [ ] `npm run build` passa sem warnings
- [ ] `npm run lint` passa  
- [ ] `npx tsc --noEmit` sem errors
- [ ] Sem console.error na dev tools

**Performance**:
- [ ] Response sizes reduzidos (check Network tab)
- [ ] Page load time < 2s
- [ ] Queries/sec reduzidas

**Functionality**:
- [ ] UI visuals unchanged
- [ ] User workflows still work
- [ ] No data loss

**Documentation**:
- [ ] PR tem descrição clara
- [ ] Link a docs: ANALISE_CONSUMO_SUPABASE.md
- [ ] Metrics before/after if possible

---

## 📝 PR Template

Ao fazer commit, use este template:

```markdown
## 📌 Task: [TASK-XXX] - Descrição

### Solução
- [ ] Explique o que foi mudado e por quê

### Arquivos Modificados
- `src/lib/arquivo.ts` - descrição
- `src/app/rota/page.tsx` - descrição

### Impacto Esperado
- -XX% bandwidth/queries
- +YYms performance improvement

### Testing
- [x] Build passa
- [x] Lint passa
- [x] TypeScript OK
- [x] Manual test (browser)
- [x] No visual regressions

### References
- Docs: ANALISE_CONSUMO_SUPABASE.md § [Section]
- Guide: PLANO_ACAO_OTIMIZACAO.md § Task X.X
- Example: REFERENCIA_TECNICA.md § Exemplo X
```

---

## 🏁 Final Checklist After All Sprints

- [ ] Sprint 1 complete (5h)
- [ ] Sprint 2 complete (4h)
- [ ] Sprint 3 complete (3h) - if time
- [ ] All PRs merged
- [ ] Production deployed
- [ ] Metrics measured
- [ ] Team debriefed
- [ ] Monitoring setup
- [ ] Documentation updated

**Expected Total**: ~12-15h work over 2-3 weeks

---

**Version**: 1.0  
**Last Updated**: March 15, 2026  
**Owner**: Tech Lead + Dev Team

