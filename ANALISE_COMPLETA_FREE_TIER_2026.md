# 🚀 ANÁLISE COMPLETA: Estratégia Free Tier Supabase + Cache + RPC

**Data**: 21 de Março de 2026  
**Status**: Estratégia Operacional  
**Objetivo**: Manter app no free tier indefinidamente com performance aceitável

---

## 📊 LIMITES SUPABASE FREE TIER (Baseline)

| Recurso | Limite Free | Status App |
|---------|------------|-----------|
| **Database Storage** | 1GB | ✅ ~100MB (safe) |
| **Egress Bandwidth** | 1GB/mês | 🔴 **20-40GB/mês PROJETADO** |
| **Conexões Simultâneas** | 5 | ⚠️ Picos durante eventos |
| **API Requests** | Unlimited | ✅ Rate limited in-code |
| **Query Performance** | Max 15s timeout | ✅ Queries OK |
| **RPC Calls** | Unlimited | ✅ Usar agressivamente |
| **Functions** | 500MB storage | ✅ Spare capacity |
| **Domain** | *.supabase.co | ✅ OK para MVP |
| **Auth Users** | Unlimited | ✅ OK |

---

## 🔴 PROBLEMA CRÍTICO: EGRESS (Consumidor #1)

### Cenário Atual sem Otimização

```
Landing Page (/): 1000 visitas/dia × 4MB/hit = 4GB/dia = 120GB/mês ❌
Álbum Público: 500 visitas/dia × 2MB/hit = 1GB/dia = 30GB/mês ❌
Events/Ligas: 300 visitas/dia × 3MB/hit = 0.9GB/dia = 27GB/mês ❌
Admin Dashboard: 50 acessos/dia × 5MB/hit = 250MB/dia = 7.5GB/mês ❌

TOTAL: ~184GB/mês (FREE TIER LIMIT: 1GB) 🚨
```

**Culpados Identificados** (conforme análise subagent):
1. Dashboard landing retorna 40 eventos com arrays gigantes (likesList, interessados)
2. Base64 images em selects de ligas/produtos
3. Album com 350 linhas por fetch sem paginação real
4. Events com 2000 RSVPs por chamada
5. Sem compressão de responses

---

## ✅ SOLUÇÃO: 3-TIER CACHE + RPC PUSHDOWN

### TIER 1: ISR (Incremental Static Regeneration) - Supabase Edge

**Onde**: Páginas públicas estáticas (landing, ligas, loja, planos)  
**TTL**: 1-24 horas  
**Benefício**: Eliminina 90% das queries públicas

```typescript
// next.config.ts (já implementado)
export default {
  revalidateTags: ['landing', 'ligas', 'loja'],  // Tag-based revalidation
}

// src/app/page.tsx (landing)
export const revalidate = 43200; // 12 horas

// src/app/ligas/page.tsx
export const revalidate = 3600; // 1 hora

// src/app/loja/page.tsx
export const revalidate = 1800; // 30 minutos
```

**Estimativa**: Reduz egress em 60-70% (de 184GB para 55GB/mês)

---

### TIER 2: API SERVER-SIDE CACHE + gzip Compression

**Onde**: Endpoints públicos em `src/app/api/`  
**Cache Storage**: Supabase Redis CLI / Upstash (free tier: 10GB)  
**Compression**: gzip (reduza payload 70-80%)

#### 2.1 Implementar Cache em /api/public/landing

```typescript
// src/app/api/public/landing/route.ts (NOVO)

import { NextRequest, NextResponse } from 'next/server';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const CACHE_TTL_MS = 300_000; // 5 minutos

class RedisCache {
  private static data = new Map<string, { value: any; expiry: number }>();

  static async get(key: string) {
    const cached = RedisCache.data.get(key);
    if (!cached || Date.now() > cached.expiry) {
      RedisCache.data.delete(key);
      return null;
    }
    return cached.value;
  }

  static async set(key: string, value: any) {
    RedisCache.data.set(key, {
      value,
      expiry: Date.now() + CACHE_TTL_MS,
    });
  }
}

export async function GET(request: NextRequest) {
  const cacheKey = 'landing_data';
  
  // Check cache first
  let data = await RedisCache.get(cacheKey);
  
  if (!data) {
    // Fetch com REDUZIDOS selects
    data = await fetchDashboardSmall(); // Ver TIER 3
    await RedisCache.set(cacheKey, data);
  }

  // Compress
  const jsonStr = JSON.stringify(data);
  const compressed = await gzip(jsonStr);

  return new Response(compressed, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Cache-Control': 'public, max-age=300',
      'X-Cache': data ? 'HIT' : 'MISS',
    },
  });
}

async function fetchDashboardSmall() {
  // REDUZIDO vs antes
  return {
    events: [], // Apenas 5 eventos (vs 40)
    products: [], // Apenas 3 (vs 8)
    album_ranking: { topXp: 100 }, // No place (vs todos)
    partners: [], // Apenas 10 (vs 50)
  };
}
```

**Impacto**: 5MB → 300KB comprimido por hit = 93% redução

---

#### 2.2 RPC Query Pushdown (TIER 3)

**Filosofia**: Deixar PostgreSQL fazer o trabalho aggregation, retornando apenas resultado final

### TIER 3: RPC Functions para Aggregation + Row Reduction

**Criar RPCs no Supabase** (via migrations):

#### RPC 1: Agregar Album Ranking Simplificado

```sql
-- migrations/2026-03-21-tier-cache-rpc.sql

/**
 * RPC: dashboard_album_simple
 * Retorna apenas TOP 10 do album vs 350 full rows
 */
CREATE OR REPLACE FUNCTION public.dashboard_album_simple()
RETURNS TABLE(
  user_id uuid,
  user_name text,
  total_xp bigint,
  user_avatar_url text
)
LANGUAGE sql
STABLE
ROWS 10
AS $$
  SELECT 
    ar.user_id,
    u.name,
    SUM(ar."totalColetado")::bigint as total_xp,
    u.avatar_url
  FROM album_rankings ar
  JOIN users u ON u.id = ar.user_id
  WHERE ar.tenant_id = (SELECT current_setting('app.current_tenant_id')::uuid)
  GROUP BY ar.user_id, u.name, u.avatar_url
  ORDER BY total_xp DESC
  LIMIT 10;
$$;

/**
 * RPC: get_events_minimal
 * Retorna apenas 5 eventos com campos essenciais
 */
CREATE OR REPLACE FUNCTION public.get_events_minimal(p_limit INT DEFAULT 5)
RETURNS TABLE(
  id uuid,
  titulo text,
  data date,
  hora time,
  imagem text,
  tenant_id uuid
)
LANGUAGE sql
STABLE
ROWS 5
AS $$
  SELECT 
    e.id,
    e.titulo,
    e.data,
    e.hora,
    e.imagem,
    e.tenant_id
  FROM eventos e
  WHERE e.tenant_id = (SELECT current_setting('app.current_tenant_id')::uuid)
    AND e.data >= CURRENT_DATE
  ORDER BY e.data, e.hora
  LIMIT p_limit;
$$;

/**
 * RPC: get_products_minimal
 * Apenas 3 produtos destaque
 */
CREATE OR REPLACE FUNCTION public.get_products_minimal(limit_items INT DEFAULT 3)
RETURNS TABLE(
  id uuid,
  nome text,
  preco numeric,
  imagem text
)
LANGUAGE sql
STABLE
ROWS 3
AS $$
  SELECT 
    p.id,
    p.nome,
    p.preco,
    p.imagem
  FROM store_products p
  WHERE p.tenant_id = (SELECT current_setting('app.current_tenant_id')::uuid)
    AND p.ativo = true
  ORDER BY p.created_at DESC
  LIMIT limit_items;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_album_simple() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_events_minimal(INT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_products_minimal(INT) TO authenticated, anon;
```

**Executar em Supabase Dashboard** → SQL Editor (copy/paste acima)

---

## 📱 ESTRATÉGIA DE CACHE: CLIENTE-LADO (TIER 4)

**Onde**: Browser localStorage + Service Workers  
**TTL**: 1-7 dias (com invalidation manual)

```typescript
// src/lib/clientCache.ts (NOVO)

export class ClientCache {
  private static PREFIX = 'app_cache_';

  static getItem<T>(key: string): T | null {
    try {
      const stored = localStorage.getItem(this.PREFIX + key);
      if (!stored) return null;
      
      const { value, expiry } = JSON.parse(stored);
      if (Date.now() > expiry) {
        this.removeItem(key);
        return null;
      }
      
      return value as T;
    } catch {
      return null;
    }
  }

  static setItem<T>(key: string, value: T, ttlMs: number = 86400000) { // 24h default
    try {
      localStorage.setItem(this.PREFIX + key, JSON.stringify({
        value,
        expiry: Date.now() + ttlMs,
      }));
    } catch {
      console.warn('[ClientCache] localStorage full');
    }
  }

  static removeItem(key: string) {
    localStorage.removeItem(this.PREFIX + key);
  }

  static invalidate(pattern: string) {
    // Remove tudo que match pattern (ex: 'events_*')
    const keys = Object.keys(localStorage);
    keys.forEach(k => {
      if (k.startsWith(this.PREFIX + pattern)) {
        localStorage.removeItem(k);
      }
    });
  }
}

// Uso:
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = 86400000
): T | null {
  const cached = ClientCache.getItem<T>(key);
  
  if (cached) {
    fetcher().then(fresh => ClientCache.setItem(key, fresh, ttlMs)); // Background refresh
    return cached;
  }

  fetcher().then(data => ClientCache.setItem(key, data, ttlMs));
  return null;
}
```

---

## 🎯 ROADMAP IMPLEMENTAÇÃO (16 horas total)

### Sprint 1: RPC + API Cache (8h)

| Task | Tempo | Arquivo | Mudança |
|------|-------|---------|---------|
| 1.1 Criar 3 RPCs | 2h | `supabase/migrations/2026-03-21-tier-cache-rpc.sql` | NEW |
| 1.2 Atualizar dashboardPublicService | 2h | `src/lib/dashboardPublicService.ts` | Usar RPC v2 minimal + reduzir selects |
| 1.3 Implementar /api/public/landing cache | 2h | `src/app/api/public/landing/route.ts` | Add gzip + Redis mock |
| 1.4 Add ClientCache.ts | 1h | `src/lib/clientCache.ts` | NEW |
| 1.5 Test + QA | 1h | - | Browser dev tools egress check |

### Sprint 2: ISR + Revalidate Tags (4h)

| Task | Tempo | Arquivo | Mudança |
|------|-------|---------|---------|
| 2.1 Set revalidate em PUBLIC pages | 1.5h | `src/app/{page.tsx, ligas/page.tsx, loja/page.tsx, ...}` | Ex: `export const revalidate = 3600` |
| 2.2 Add revalidate tags | 1.5h | API routes | `revalidatePath('/ligas', 'page')` after mutations |
| 2.3 Disable cache para [id] dynamic pages | 0.5h | `src/app/**/[id]/page.tsx` | `export const revalidate = 60` |
| 2.4 Test via `npm run build` | 0.5h | - | Verify ISR generated |

### Sprint 3: Egress Reduction - String in Selects (3h)

| Task | Tempo | Arquivo | Mudança |
|------|-------|---------|---------|
| 3.1 Remove logoBase64 | 1h | dashboardPublicService.ts, leaguesService.ts, etc | 5 arquivos ~7-8 linhas cada |
| 3.2 Remove likesList, interessados | 1h | dashboardPublicService.ts | Fetch lazy ou via separate call |
| 3.3 Implementar lazy Image load | 1h | Gallery components | `priority={false}` no Next Image |

### Sprint 4: Rate Limiting + Monitoring (1h)

| Task | Tempo | Arquivo |
|------|-------|---------|
| 4.1 Extend rateLimiter.ts | 0.5h | `src/lib/rateLimiter.ts` |
| 4.2 Add dashboard query monitor | 0.5h | `src/lib/queryMonitor.ts` (NEW) |

---

## 🛡️ EGRESS MINIMIZATION CHECKLIST

### ✅ Phase 1: Immediate Wins (Do this FIRST)

- [ ] **1. Remove Base64 Images from Selects**
  - [ ] dashboardPublicService.ts: Remove `logoBase64`, `fotoBase64`
  - [ ] leaguesService.ts: Remove base64 fields
  - [ ] Impact: 60% size reduction in those endpoints
  - [ ] Time: 30 min

- [ ] **2. Reduce Query Limits**
  - [ ] DASHBOARD_EVENTS_FETCH_LIMIT: 40 → 5
  - [ ] DASHBOARD_PRODUCTS_LIMIT: 8 → 3
  - [ ] DASHBOARD_PARTNERS_LIMIT: 50 → 10
  - [ ] DASHBOARD_ALBUM_FALLBACK_LIMIT: 350 → 30
  - [ ] Impact: 60-70% reduction in dashboard payload
  - [ ] Time: 30 min

- [ ] **3. Add gzip Compression in API Routes**
  - [ ] src/app/api/public/landing/route.ts
  - [ ] src/app/api/public/tenants/route.ts
  - [ ] Impact: 70-80% reduction per response
  - [ ] Time: 1h

**Expected after Phase 1**: 184GB/mth → ~50GB/mth ✅

---

### ✅ Phase 2: RPC + Server Cache (Do this SECOND)

- [ ] **4. Deploy Dashboard RPCs to Supabase**
  - [ ] `dashboard_album_simple()` - return 10 rows vs 350
  - [ ] `get_events_minimal()` - return 5 vs 40
  - [ ] `get_products_minimal()` - return 3 vs 8
  - [ ] Impact: 50% reduction in query sizes
  - [ ] Time: 1.5h

- [ ] **5. Update Services to Use New RPCs**
  - [ ] dashboardPublicService.ts: Call RPC instead SELECT
  - [ ] leaguesService.ts: Use RPC for top leagues
  - [ ] Time: 1h

- [ ] **6. Implement Redis-like Cache Mock**
  - [ ] src/lib/serverCache.ts (in-memory map)
  - [ ] TTL: 5-15 minutes
  - [ ] Keys: dashboard_data, events, products
  - [ ] Impact: 80% cache hit rate on landing
  - [ ] Time: 1.5h

**Expected after Phase 2**: 50GB → ~10GB/mth ✅

---

### ✅ Phase 3: ISR + Client Cache (Do this THIRD)

- [ ] **7. Set ISR Revalidation**
  - [ ] Landing page: 12 hours (43200s)
  - [ ] Leagues: 1 hour (3600s)
  - [ ] Store: 30 min (1800s)
  - [ ] Impact: 95% reduction in request frequency
  - [ ] Time: 1h

- [ ] **8. Implement ClientCache**
  - [ ] src/lib/clientCache.ts
  - [ ] localStorage + expiry check
  - [ ] Invalidation patterns
  - [ ] Time: 1.5h

- [ ] **9. Remove Array Fields from Selects**
  - [ ] `likesList` → fetch separately via RPC if needed
  - [ ] `interessados` → aggregated count only
  - [ ] `voters` in polls → count only
  - [ ] Impact: 40% payload reduction
  - [ ] Time: 1h

**Expected after Phase 3**: 10GB → ~1.2GB/mth ✅ (within free tier!)

---

## 📈 MONITORAMENTO & ALERTAS

### Query Performance Dashboard

```typescript
// src/lib/queryMonitor.ts (NOVO)

interface QueryMetric {
  endpoint: string;
  method: string;
  timestamp: Date;
  durationMs: number;
  payloadBytes: number;
  tenant_id: string;
}

export class QueryMonitor {
  private static metrics: QueryMetric[] = [];
  private static MAX_METRICS = 1000;

  // Call this in every API route
  static recordQuery(metric: Omit<QueryMetric, 'timestamp'>) {
    QueryMonitor.metrics.push({
      ...metric,
      timestamp: new Date(),
    });

    // Keep only last 1000
    if (QueryMonitor.metrics.length > QueryMonitor.MAX_METRICS) {
      QueryMonitor.metrics.shift();
    }
  }

  // GET /admin/query-stats
  static getStats(minutes: number = 60) {
    const cutoff = Date.now() - minutes * 60_000;
    const filtered = QueryMonitor.metrics.filter(
      m => m.timestamp.getTime() > cutoff
    );

    return {
      total_queries: filtered.length,
      total_bytes: filtered.reduce((sum, m) => sum + m.payloadBytes, 0),
      avg_duration_ms: filtered.length > 0
        ? filtered.reduce((sum, m) => sum + m.durationMs, 0) / filtered.length
        : 0,
      by_endpoint: Object.groupBy(filtered, m => m.endpoint),
    };
  }
}

// Usage em src/app/api/public/landing/route.ts:
export async function GET(req: NextRequest) {
  const start = Date.now();
  const data = await fetchDashboard();
  const payloadBytes = JSON.stringify(data).length;

  QueryMonitor.recordQuery({
    endpoint: '/api/public/landing',
    method: 'GET',
    durationMs: Date.now() - start,
    payloadBytes,
    tenant_id: 'global_public',
  });

  return NextResponse.json(data);
}
```

### Métricas para Rastrear (Dashboard Admin)

```typescript
// Interface para admin/query-analytics/page.tsx
interface EgressMetrics {
  daily_egress_bytes: number;
  monthly_projected_gb: number;
  cache_hit_rate: number;
  cache_miss_count: number;
  top_consumers: Array<{ endpoint: string; bytes: number; percent: number }>;
  recommendations: string[];
}

// Exemplo de dados:
{
  daily_egress_bytes: 100_000_000, // 100MB/day
  monthly_projected_gb: 3, // Safe
  cache_hit_rate: 0.87, // 87% hit rate
  cache_miss_count: 1234,
  top_consumers: [
    { endpoint: '/api/public/landing', bytes: 50_000_000, percent: 50 },
    { endpoint: '/api/public/tenants', bytes: 30_000_000, percent: 30 },
  ],
  recommendations: [
    "Increase ISR revalidate from 300s to 600s",
    "Cache hit rate is good (87%); maintain current settings",
  ]
}
```

---

## 🔑 KEY TAKEAWAYS: TIER FREE INDEFINIDAMENTE

| Estratégia | Impacto | Esforço | Status |
|-----------|---------|--------|--------|
| **SSR Reduction via ISR** | -70% requests | 1h | ⭐ Priority #1 |
| **Gzip Compression** | -75% payload | 1h | ⭐ Priority #2 |
| **Remove Base64 Images** | -60% size | 30m | ⭐ Priority #2 |
| **RPC Aggregation** | -50% query size | 2h | ⭐ Priority #3 |
| **Query Limits Reduction** | -60% rows | 30m | ⭐ Priority #1 |
| **Server-side Cache** | -80% hits | 1.5h | ⭐ Priority #3 |
| **Client-side Cache** | -95% loads | 1.5h | ⭐ Priority #4 |
| **Rate Limiting** | Prevent abuse | 30m | ✅ Já existe |

---

## 📝 OBSERVAÇÕES FINAIS

1. **Supabase Free tier é REALMENTE 1GB egress/mês** - Não é mito. Precisa de estratégia agressiva.

2. **PostgreSQL side é OK** - Storage está bem (~100MB). Queries rodam rápido com bons índices (assumindo que já tem).

3. **RPC é seu melhor amigo** - Deixar PostgreSQL fazer aggregations economiza 50-70% de transferência.

4. **Cache em 3 níveis é obrigatório**:
   - ISR (build-time, sem queries)
   - Server-side (5-15 min, com gzip)
   - Client-side (localStorage, 1-7 dias)

5. **Monitoramento = Essencial** - Sem metrics, não consegue otimizar. Criar dashboard admin ASAP.

6. **Próxima escala**: Se pass de 2-3GB/mês com estratégia acima, considere:
   - Upgrade para Supabase Pro ($25/mth, 50GB egress)
   - CDN externo (Cloudflare, BunnyCDN) para assets estáticos
   - Edge functions em Vercel para cache distribuído

---

## 🚀 PRÓXIMOS PASSOS

1. ✅ **Hoje**: Ler este documento, criar plano com time
2. ✅ **Amanhã**: Sprint 1 - Deploy RPCs + API cache gzip
3. ✅ **Dia 3**: Sprint 2 - ISR + revalidate tags
4. ✅ **Dia 4**: Sprint 3 - Egress reduction checklist
5. ✅ **Dia 5**: QA + Deploy, monitorar métricas

