# Plano de Ação - Otimização Consumo Supabase

> Follow-up técnico para: `ANALISE_CONSUMO_SUPABASE.md`

---

## Sprint 1: Quick Wins (Crítico - 18h total)

### Task 1.1: Reduzir Dashboard Events Load 
**Tempo**: 2h | **Arquivo**: `src/lib/dashboardPublicService.ts`

**Mudanças**:

```typescript
// ANTES (linhas ~12-20)
const DASHBOARD_EVENTS_FETCH_LIMIT = 40;
const DASHBOARD_EVENTS_SELECT =
  "id,titulo,data,hora,local,imagem,tipo,status,likesList,interessados,imagePositionY,tenant_id";

// DEPOIS
const DASHBOARD_EVENTS_FETCH_LIMIT = 5;  // ⬇️ 40 → 5
const DASHBOARD_EVENTS_SELECT =
  "id,titulo,data,hora,imagem,tipo,status,tenant_id";  // ⬇️ Removido: imagePositionY, likesList, interessados
```

**Por quê**: 
- 5 eventos são suficientes visual na landing page
- Remover arrays grandes (likesList, interessados) economiza ~500KB por fetch
- Se 1000 visitantes/dia × 500KB = 500GB redução/mês

**Verificar após**: Página carrega em < 2s, visual não muda

---

### Task 1.2: Remove Base64 Images de Todos os Selects
**Tempo**: 3h | **Arquivos**: Multiple

**Busca e substitua**:

```bash
# Encontre todos logoBa64 references
rg -l "logoBase64" src/
# Esperado: ~8 arquivos
```

**Arquivos para editar**:

1. `src/lib/dashboardPublicService.ts` (linha ~250)
```typescript
// ANTES
const DASHBOARD_LIGAS_SELECT =
  "id,nome,sigla,foto,logoUrl,logoBase64,logo,descricao,bizu,ativa,visivel,status,createdAt,updatedAt";

// DEPOIS
const DASHBOARD_LIGAS_SELECT =
  "id,nome,sigla,foto,logoUrl,descricao,bizu,ativa,visivel,status,createdAt";
```

2. `src/lib/leaguesService.ts` (procure pelo LEAGUES_SELECT_COLUMNS)
```typescript
// ANTES
const LEAGUES_SELECT_COLUMNS = [
  "id", "nome", "sigla", "presidente", "descricao",
  "logoUrl", "logoBase64", "visivel", "ativa",
  // ... mais 10+ colunas
];

// DEPOIS
const LEAGUES_SELECT_COLUMNS = [
  "id", "nome", "sigla", "descricao",
  "logoUrl", "visivel", "ativa", "membros",
  // Remove: logoBase64, presidente, bizu, etc se não visíveis
];
```

3. `src/app/admin/loja/produtos/page.tsx` - se busca por base64
4. `src/lib/storeService.ts` - produtos com imagens

**Componentes a atualizar** (lazy load ou defer):
```typescript
// Em ligas/page.tsx, loja/page.tsx, etc.
// Se precisar logoBase64, fazer query SEPARADA:

export async function fetchLigaLogoBase64(ligaId: string) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from("ligas_config")
        .select("logoBase64")
        .eq("id", ligaId)
        .maybeSingle();
    
    if (error) return null;
    return data?.logoBase64;
}

// Usar em componente com Suspense/loading state
```

**Impacto**: 60-70% tamanho reduzido em endpoints que retornam ligas

---

### Task 1.3: Aumentar Cache TTL & Add Revalidate
**Tempo**: 2h | **Arquivos**: Multiple

**Padrão a implementar**:

```typescript
// ===== Em todos os services que fazem queries config =====

// ANTES
const READ_CACHE_TTL_MS = 30_000;  // 30 segundos

// DEPOIS  
const READ_CACHE_TTL_MS = 300_000;  // 5 minutos (10x menos fetches!)

// Adicionar cache-first strategy:
export async function fetchXYZConfig(options?: { forceRefresh?: boolean }) {
    const cacheKey = "xyz_config";
    
    // ANTES: sempre cachecker todo acesso
    if (!options?.forceRefresh) {
        const cached = getCachedValue(cache, cacheKey);
        if (cached) return cached;  // Serve cached data
    }
    
    // ... rest of function
}
```

**Em routes.ts (API)**:

```typescript
// ANTES
export const revalidate = "use-cache";  // ou nenhum revalidate

// DEPOIS - `/api/public/*` routes
export const revalidate = 300;  // ISR: revalidate cada 5min
// Supabase + Next.js cache então composto = 5min de super-cache!

// DEPOIS - `/api/admin/*` routes
export const revalidate = 60;  // Admin: 1min freshness
```

**Arquivos a atualizar**:
- `src/lib/dashboardPublicService.ts`: TTL 30s → 300s
- `src/lib/leaguesService.ts`: TTL 30s → 300s  
- `src/lib/rankingService.ts`: TTL 25s → 300s
- `src/app/api/public/landing/route.ts`: add `revalidate = 300`
- `src/app/api/public/tenants/route.ts`: change `revalidate = 300`

**Impacto**: -80% queries em 5 minutos após primeiro acesso

---

### Task 1.4: Pagination p/ Store Orders
**Tempo**: 4h | **Arquivo**: `src/lib/storeService.ts`

**Mudança estrutural**:

```typescript
// ANTES (linha ~110)
export async function fetchStoreOrders(options?: {
    userId?: string;
    limit?: number;
}): Promise<StoreOrder[]> {
    const supabase = getSupabaseClient();
    const requestedLimit = options?.limit ?? 50;
    const limit = boundedLimit(requestedLimit, MAX_ORDERS);  // MAX_ORDERS = 1200 ❌
    
    let q = supabase.from("orders").select(STORE_ORDER_SELECT_COLUMNS).limit(limit);
    
    if (options?.userId) {
        q = q.eq("userId", options.userId);
    }
    
    const { data, error } = await q.order("createdAt", { ascending: false });
    // ...returns up to 1200 rows at once
}

// DEPOIS (cursor-based pagination)
export interface StorePaginationCursor {
    lastOrderId: string;
    lastCreatedAt: string;
}

export async function fetchStoreOrdersPage(options: {
    userId?: string;
    pageSize?: number;  // 20 per page
    cursor?: StorePaginationCursor;  
}): Promise<{
    orders: StoreOrder[];
    nextCursor?: StorePaginationCursor;
}> {
    const supabase = getSupabaseClient();
    const pageSize = Math.min(options.pageSize ?? 20, 50);  // Max 50
    
    // Only fetch columns we actually display
    const selectCols = "id,userId,userName,productId,productName,preco,quantity,status,data";
    
    let q = supabase
        .from("orders")
        .select(selectCols)
        .order("createdAt", { ascending: false })
        .limit(pageSize + 1);  // +1 to detect if there's next page
    
    if (options?.userId) {
        q = q.eq("userId", options.userId);
    }
    
    // Cursor-based filtering
    if (options?.cursor) {
        q = q.lt("createdAt", options.cursor.lastCreatedAt)
            .lt("id", options.cursor.lastOrderId);  // Secondary sort for tie-breaking
    }
    
    const { data, error } = await q;
    if (error) throw error;
    
    const orders = (data ?? []) as StoreOrder[];
    const hasMore = orders.length > pageSize;
    const result = hasMore ? orders.slice(0, pageSize) : orders;
    
    return {
        orders: result.map(normalizeStoreOrder),
        nextCursor: hasMore ? {
            lastOrderId: result[result.length - 1].id,
            lastCreatedAt: result[result.length - 1].createdAt,
        } : undefined,
    };
}
```

**Em UI (React Component)**:

```typescript
// ANTES
const { data: allOrders } = await fetchStoreOrders({ userId });
setOrders(allOrders);  // Render all 1200

// DEPOIS
const [cursor, setCursor] = useState<StorePaginationCursor | undefined>();
const { orders, nextCursor } = await fetchStoreOrdersPage({
    userId,
    pageSize: 20,
    cursor,
});

// Em componente:
<button onClick={() => setCursor(nextCursor)}>Load More</button>
```

**Impacto**: Query size 1200 rows → 20 rows = 98% reduction per request

---

### Task 1.5: Rate Limiting Middleware  
**Tempo**: 3h | **Novo arquivo**: `src/lib/rateLimiter.ts` + `src/middleware.ts`

**Criar**: `src/lib/rateLimiter.ts`

```typescript
// Simple in-memory rate limiter
const requestCounts = new Map<string, { count: number; resetAt: number }>();

const WINDOW_MS = 60_000;  // 1 minute
const MAX_REQUESTS = {
    "/api/public/landing": 30,   // 30 req/min per IP
    "/api/public/tenants": 60,   // 60 req/min per IP
    "/api/default": 100,         // 100 req/min per IP
};

export function getRateLimitKey(ip: string, path: string): string {
    const normalized = path.split("?")[0];  // Remove query string
    return `${ip}:${normalized}`;
}

export function isRateLimited(
    ip: string,
    path: string,
    now: number = Date.now()
): boolean {
    const key = getRateLimitKey(ip, path);
    const limit = MAX_REQUESTS[path] ?? MAX_REQUESTS["/api/default"];
    
    const record = requestCounts.get(key);
    
    if (!record) {
        // First request
        requestCounts.set(key, { count: 1, resetAt: now + WINDOW_MS });
        return false;
    }
    
    if (now > record.resetAt) {
        // Window expired
        requestCounts.set(key, { count: 1, resetAt: now + WINDOW_MS });
        return false;
    }
    
    // Still in window
    if (record.count >= limit) {
        return true;  // Rate limited!
    }
    
    record.count++;
    return false;
}

export function cleanupExpiredBuckets(now: number = Date.now()) {
    // Clean up old entries to prevent memory leak
    for (const [key, record] of requestCounts.entries()) {
        if (now > record.resetAt + WINDOW_MS) {
            requestCounts.delete(key);
        }
    }
}
```

**Update**: `src/middleware.ts` (ou criar se não existe)

```typescript
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isRateLimited, cleanupExpiredBuckets } from "@/lib/rateLimiter";

export function middleware(request: NextRequest) {
    const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        request.ip ||
        "unknown";

    const path = request.nextUrl.pathname;
    
    // Only rate limit public API endpoints
    if (path.startsWith("/api/public/")) {
        if (isRateLimited(ip, path)) {
            return NextResponse.json(
                { error: "Rate limit exceeded. Try again in 1 minute." },
                { status: 429 }
            );
        }
    }

    // Cleanup every 5 minutes
    if (Math.random() < 0.01) {  // 1% of requests
        cleanupExpiredBuckets();
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/api/:path*", "/((?!_next).)*"],  // Protege todos /api/*
};
```

**Update**: `next.config.ts` - ensure middleware runs

```typescript
// Already should be here, just verify:
const config: NextConfig = {
    // ... existing config
    experimental: {
        middleware: true,  // or remove if next version >= 13
    },
};
```

**Impacto**: -100% scrapers/bots podem fazer abuso

**Test**:
```bash
# Should fail on 31st request in 1 minute
for i in {1..35}; do curl http://localhost:3000/api/public/landing; done
# Should see 429 errors after request 30
```

---

## Sprint 2: Cleanup Connections (4h total)

### Task 2.1: Fix Realtime Subscriptions Leaks
**Tempo**: 2h | **Arquivo**: `src/context/AuthContext.tsx` + components com `.on()`

**Pattern a implementar**:

```typescript
// ANTES - ❌ Memory leak
useEffect(() => {
    const channel = supabase
        .channel("users")
        .on("*", (payload) => {
            console.log("User updated", payload);
        })
        .subscribe();
}, []);

// DEPOIS - ✅ Proper cleanup
useEffect(() => {
    const channel = supabase
        .channel("users:*")
        .on("postgres_changes", { event: "*", schema: "public", table: "users" }, 
            (payload) => {
                console.log("User updated", payload);
            }
        )
        .subscribe();

    return () => {
        channel.unsubscribe();  // ✅✅✅ CRITICAL
        supabase.removeChannel(channel);
    };
}, []);
```

**Procurar por**:
```bash
rg -A 5 "\.on\(" src/ --type ts --type tsx
# Encontre cada um e adicione cleanup
```

**Especialmente em**:
- `src/context/AuthContext.tsx` 
- `src/app/comunidade/*` (se há live comments)
- `src/app/sharkround/*` (se há realtime game updates)

---

### Task 2.2: Batch User Stats Updates
**Tempo**: 2h | **Arquivo**: `src/lib/supabaseData.ts`

**Problema**: Cada `incrementUserStats()` faz 2 queries (SELECT + UPDATE)

```typescript
// ANTES
export async function incrementUserStats(
  userId: string,
  deltas: Record<string, number>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: current } = await supabase  // Query 1
    .from("users")
    .select("stats")
    .eq("uid", userId)
    .maybeSingle();
  
  // ... merge logic
  
  const { error: updateError } = await supabase  // Query 2
    .from("users")
    .update({ stats: nextStats, updatedAt: now })
    .eq("uid", userId);
}

// Se 100 game plays/dia × 2 = 200 queries = 5-10MB
```

**Solução**: Usar Postgres function

```sql
-- Criar função no Supabase
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

```typescript
// DEPOIS - uma query só!
export async function incrementUserStats(
  userId: string,
  deltas: Record<string, number>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc(
    "increment_user_stats",
    { user_id: userId, stat_deltas: deltas }
  );
  
  if (error) throw error;
  // ✅ 1 query ao invés de 2 = 50% menos banda
}
```

---

## Sprint 3: Long-term (Database Level)

### Task 3.1: Add Database Indexes  
**Tempo**: 1h | **Arquivo**: `docs/supabase_optimization.sql` (criar novo)

```sql
-- Executar via Supabase SQL Editor

-- Para ranking queries
CREATE INDEX IF NOT EXISTS idx_users_tenant_xp 
ON users(tenant_id, xp DESC) 
WHERE status = 'ativo';

-- Para event queries
CREATE INDEX IF NOT EXISTS idx_eventos_data 
ON eventos(data DESC) 
WHERE status = 'ativo';

-- Para league queries  
CREATE INDEX IF NOT EXISTS idx_ligas_tenant_status
ON ligas_config(tenant_id, ativa)
WHERE visivel = true;

-- Para store queries
CREATE INDEX IF NOT EXISTS idx_orders_user_date
ON orders(userId, createdAt DESC);

-- Para turma lookups
CREATE INDEX IF NOT EXISTS idx_users_turma_xp
ON users(turma, xp DESC)
WHERE status = 'ativo' AND role = 'user';

-- Verify indexes foram criados
SELECT * FROM pg_indexes WHERE schemaname = 'public';
```

---

### Task 3.2: Archive Old Notifications
**Tempo**: 2h | **Arquivo**: SQL + `docs/archive_strategy.md`

```sql
-- Criar tabela de archive (uma vez)
CREATE TABLE notifications_archive (
    LIKE notifications INCLUDING ALL
);

-- Move old notifications (run monthly)
BEGIN;
INSERT INTO notifications_archive 
SELECT * FROM notifications
WHERE created_at < NOW() - INTERVAL '6 months';

DELETE FROM notifications
WHERE created_at < NOW() - INTERVAL '6 months';

COMMIT;

-- Result: 100MB+ table shrinks by 30-50%
```

---

## Métricas de Sucesso

**Após Sprint 1 (1.1-1.5)**:

| Métrica | Antes | Depois | % Redução |
|---------|-------|--------|-----------|
| Dashboard /landing bytes | 5MB | 500KB | -90% |
| Queries/min (típico) | 500 | 100 | -80% |
| Avg response time | 2000ms | 400ms | -80% |
| Liga listing bytes | 2MB | 200KB | -90% |
| Store orders fetch | 50MB | 500KB | -99% |
| Rate limit abuses | 100/day | 0 | -100% |

**Total esperado após tudo**: ~75% redução consumo

---

## Testing Checklist

```bash
# Antes de fazer PR:

# 1. Build passa sem warnings
npm run build

# 2. Lint passa
npm run lint

# 3. Tipos corretos
npx tsc --noEmit

# 4. Páginas carregam rápido (2s max)
curl -w "@curl-format.txt" -o /dev/null -s https://local/

# 5. Sem memory leaks (check DevTools)
# Abrir DevTools > Memory > Detached DOM nodes permanentes

# 6. Rate limiter funciona
for i in {1..35}; do curl http://localhost:3000/api/public/landing; done

# 7. Dados aparecem iguais para usuário final
# Visual regression test manual
```

---

## Rollback Plan

Se algo quebrar:

```bash
# 1. Identify qual commit quebrou
git log --oneline -10

# 2. Revert individual change
git revert <commit-hash>

# 3. Re-deploy
npm run build && npm run deploy

# 4. Verify via dashboard
# Check Supabase dashboard queries/latency normalized
```

---

## Próximo Review

- **1 semana após Sprint 1**: Medir redução real vs estimado
- **2 semanas após Sprint 2**: Verificar connection pool health  
- **1 mês**: Full optimization analysis, coletando métricas

**Who**: Tech lead + DevOps  
**When**: Weekly standup

