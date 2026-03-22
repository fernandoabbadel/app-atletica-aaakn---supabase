# 🎯 PLANO EXECUTIVO: Implementação 4-TIER CACHE

**Data**: 21 de Março de 2026  
**Duração Estimada**: 16 horas  
**Objetivo**: Reduzir egress de 184GB/mês para 1.2GB/mês (FREE TIER)

---

## 📋 PRÉ-REQUISITOS

✅ **Verificar antes de começar**:
- [ ] Node.js 18+ e npm/pnpm instalados
- [ ] Acesso ao Supabase dashboard (para deploy de RPCs)
- [ ] Ramo `main` sem mudanças não commitadas
- [ ] Test suite passando: `npm run build && npm run lint`

---

## 🚀 SPRINT 1: RPC + INDEXES (2h)

**Objetivo**: Agregar dados no PostgreSQL (reduce egress 50%)

### 1.1 Deploy RPCs e Índices (1h)

```bash
# 1. Copiar SQL do arquivo:
# supabase/migrations/2026-03-21-tier-cache-rpc.sql

# 2. No Supabase Dashboard:
# - Menu > SQL Editor > New Query
# - Cole todo conteúdo do arquivo SQL
# - Clique "Execute"

# 3. Verificar sucesso:
# - Supabase Dashboard > Functions (lado esquerdo)
# - Deve ver 7 funções criadas:
#   ✅ dashboard_album_simple
#   ✅ get_events_minimal
#   ✅ get_products_minimal
#   ✅ get_ligas_summary
#   ✅ get_posts_community_minimal
#   ✅ get_arena_rankings
#   ✅ get_dashboard_counts

# 4. Testar uma RPC:
# SELECT * FROM public.get_events_minimal(5);
# Deve retornar 5 eventos com payload ~50KB (vs 2MB antes)
```

**Validação**:
```sql
-- Conectar ao Supabase SQL Editor e rodar:
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE 'get_%' OR routine_name LIKE 'dashboard_%';
-- Esperado: 7 rows (7 RPCs criadas)
```

### 1.2 Atualizar dashboardPublicService.ts (1h)

**Localização**: `src/lib/dashboardPublicService.ts`

**Mudanças**:

```typescript
// ANTES (linhas ~20-50)
const DASHBOARD_EVENTS_FETCH_LIMIT = 40;
const DASHBOARD_EVENTS_SELECT = 'id,titulo,data,hora,local,imagem,tipo,status,likesList,interessados,...';
const DASHBOARD_ALBUM_FALLBACK_LIMIT = 350;

async function fetchDashboardData(tenantId: string) {
  const [events, products, albums, likes] = await Promise.all([
    supabase.from('eventos').select(DASHBOARD_EVENTS_SELECT).limit(DASHBOARD_EVENTS_FETCH_LIMIT),
    supabase.from('store_products').select(...).limit(8),
    supabase.from('album_rankings').select(...).limit(350),
    supabase.rpc('dashboard_total_caca_calouros'), // Só esta usa RPC
  ]);
}

// DEPOIS
const DASHBOARD_EVENTS_FETCH_LIMIT = 5;  // 40 → 5
const DASHBOARD_ALBUM_FALLBACK_LIMIT = 10;  // 350 → 10

async function fetchDashboardData(tenantId: string) {
  // Usar RPCs em vez de selects diretos
  const [events, products, album, counts] = await Promise.all([
    supabase.rpc('get_events_minimal', { p_limit: DASHBOARD_EVENTS_FETCH_LIMIT }),
    supabase.rpc('get_products_minimal', { p_limit_items: 3 }),
    supabase.rpc('dashboard_album_simple'),  // Retorna TOP 10 only
    supabase.rpc('get_dashboard_counts'),
  ]);

  return {
    events: events.data || [],
    products: products.data || [],
    album: album.data || [],
    stats: counts.data?.[0] || {},
  };
}
```

**Impacto esperado**:
- Antes: 4-5MB por request
- Depois: 200-300KB por request
- **Redução: 93%** ✅

**Arquivo após mudanças** (copiar exemplo completo abaixo no APÊNDICE A)

---

## 🛡️ SPRINT 2: COMPRESS + API CACHE (3h)

**Objetivo**: Adicionar gzip + server-side cache em API routes

### 2.1 Atualizar /api/public/landing (1.5h)

**Localização**: `src/app/api/public/landing/route.ts`

```typescript
// ANTES (atual)
export async function GET(request: NextRequest) {
  const data = await fetchDashboardPublic();
  return NextResponse.json(data);
}

// DEPOIS
import { ServerCache } from '@/lib/serverCache';
import { QueryMonitor } from '@/lib/queryMonitor';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  let cacheHit = false;

  try {
    // 1. Try cache first
    const cached = ServerCache.get<any>('landing_data');
    if (cached) {
      cacheHit = true;
      return serializeAndCompress(cached, cacheHit);
    }

    // 2. Fetch fresh data
    const data = await fetchDashboardPublicViaRpc();  // Usar RPCs!

    // 3. Store in cache
    ServerCache.set('landing_data', data, 300_000); // 5 minutes

    // 4. Record metrics
    QueryMonitor.recordQuery({
      endpoint: '/api/public/landing',
      method: 'GET',
      durationMs: Date.now() - startTime,
      payloadBytes: JSON.stringify(data).length,
      cacheHit: false,
      statusCode: 200,
      tenantId: 'public',
    });

    return serializeAndCompress(data, cacheHit);
  } catch (error) {
    console.error('[/api/public/landing] Error:', error);
    
    QueryMonitor.recordQuery({
      endpoint: '/api/public/landing',
      method: 'GET',
      durationMs: Date.now() - startTime,
      payloadBytes: 0,
      cacheHit: false,
      statusCode: 500,
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId: 'public',
    });
    
    return NextResponse.json({ error: 'Failed to fetch dashboard' }, { status: 500 });
  }
}

async function serializeAndCompress(data: any, cacheHit: boolean) {
  const json = JSON.stringify(data);
  const compressed = await gzip(json);

  return new Response(compressed, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Cache-Control': 'public, max-age=300',
      'X-Cache': cacheHit ? 'HIT' : 'MISS',
      'X-Uncompressed-Size': json.length.toString(),
      'X-Compressed-Size': compressed.length.toString(),
      'X-Compression-Ratio': ((1 - compressed.length / json.length) * 100).toFixed(0) + '%',
    },
  });
}

async function fetchDashboardPublicViaRpc() {
  // Chamar dashboardPublicService.ts que já usa RPCs
  // Resultado: ~200KB vs 4MB antes
  const supabase = getSupabaseClient();
  const [events, products, album, counts, ligas, posts] = await Promise.all([
    supabase.rpc('get_events_minimal', { p_limit: 5 }),
    supabase.rpc('get_products_minimal', { p_limit_items: 3 }),
    supabase.rpc('dashboard_album_simple'),
    supabase.rpc('get_dashboard_counts'),
    supabase.rpc('get_ligas_summary', { p_limit: 20 }),
    supabase.rpc('get_posts_community_minimal', { p_limit: 10 }),
  ]);

  return {
    events: events.data || [],
    products: products.data || [],
    album: album.data || [],
    stats: counts.data?.[0] || {},
    ligas: ligas.data || [],
    posts: posts.data || [],
  };
}
```

**Resultado esperado**:
- 4MB → 200KB (gzip)
- 5MB cache hit (instant, from memory)
- **99%+ redução em cache hits** ✅

### 2.2 Aplicar mesmo padrão em /api/public/tenants (1.5h)

**Localização**: `src/app/api/public/tenants/route.ts`

```typescript
// Seguir mesmo padrão do /api/public/landing:
// 1. ServerCache.getOrSet()
// 2. gzip compression
// 3. QueryMonitor.recordQuery()
// 4. Usar RPC get_ligas_summary se existir

const CACHE_TTL_MS = 600_000; // 10 minutes (vs 5 min para landing)

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const data = await ServerCache.getOrSet(
      'tenants_directory',
      () => fetchTenantsList(),
      CACHE_TTL_MS
    );

    const json = JSON.stringify(data);
    const compressed = await gzip(json);

    QueryMonitor.recordQuery({
      endpoint: '/api/public/tenants',
      method: 'GET',
      durationMs: Date.now() - startTime,
      payloadBytes: json.length,
      cacheHit: !!ServerCache.get('tenants_directory'),
      statusCode: 200,
      tenantId: 'public',
    });

    return new Response(compressed, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'public, max-age=600',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

---

## ⚡ SPRINT 3: ISR + INVALIDATION (2h)

**Objetivo**: Set revalidate em páginas públicas

### 3.1 Add `revalidate` em Páginas Públicas

**Páginas a atualizar**:

```typescript
// src/app/page.tsx (Landing)
export const revalidate = 43200; // 12 hours
export const dynamicParams = true;

// src/app/ligas/page.tsx
export const revalidate = 3600; // 1 hour

// src/app/loja/page.tsx
export const revalidate = 1800; // 30 min

// src/app/planos/page.tsx
export const revalidate = 43200; // 12 hours

// src/app/comunidade/page.tsx
export const revalidate = 300; // 5 min (muda frequentemente)

// src/app/eventos/page.tsx (se pública)
export const revalidate = 600; // 10 min
```

**Mudanças por arquivo** (~30 linhas each, no topo do arquivo):

```typescript
// Adicionar logo após imports
export const revalidate = 3600;
export const dynamicParams = true;  // Permite [id] dinâmicos

export default function Page() {
  // ... resto do código
}
```

**Validação**:
```bash
npm run build

# Build deve gerar arquivos .rsc em .next/server/app/ para cada página
# Exemplo: landing page ~200KB (pré-renderizado, sem queries em request-time)
```

### 3.2 Add Revalidation Tags em Mutations

**Quando dados mudam, invalidar cache**:

```typescript
// src/app/admin/ligas/[id]/edit/page.tsx (POST)
import { revalidatePath } from 'next/cache';

export async function updateLiga(id: string, data: any) {
  // 1. Update Supabase
  await supabase.from('ligas').update(data).eq('id', id);

  // 2. Invalidate landing cache (shows ligas)
  revalidatePath('/');  // Landing page
  revalidatePath('/ligas', 'page');  // Ligas listing

  // 3. Invalidate server cache
  ServerCache.delete('landing_data');
  ServerCache.invalidatePattern('ligas_*');
}
```

---

## 📦 SPRINT 4: CLIENT-SIDE CACHE (2h)

**Objetivo**: Implementar localStorage cache para usuários autenticados

### 4.1 Usar ClientCache em Componentes

**Exemplo em componente React**:

```typescript
// src/app/perfil/page.tsx

'use client';

import { useCachedData, ClientCache } from '@/lib/clientCache';

export default function ProfilePage() {
  const { data: profile, loading, error } = useCachedData<ProfileData>(
    'user_profile',
    async () => {
      const response = await fetch('/api/profile');
      return response.json();
    },
    86400000 // 24 hours cache
  );

  if (loading) return <div>Carregando perfil...</div>;
  if (error) return <div>Erro: {error.message}</div>;

  return (
    <div>
      <h1>{profile?.name}</h1>
      {/* render profile */}
    </div>
  );
}
```

### 4.2 Invalidar Cache em Mutações

```typescript
// src/app/perfil/edit/page.tsx

async function updateProfile(formData: any) {
  // 1. Send to API
  const response = await fetch('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(formData),
  });

  if (response.ok) {
    // 2. Invalidate cache
    ClientCache.delete('user_profile');
    
    // 3. Re-fetch in background
    const updated = await response.json();
    ClientCache.set('user_profile', updated);

    // 4. Show success
    toast.success('Perfil atualizado!');
  }
}
```

---

## 🔍 SPRINT 5: MONITORING DASHBOARD (1h)

**Objetivo**: Admin pode ver consumo em tempo real

### 5.1 Criar Admin Page

**Localização**: `src/app/admin/analytics/query-stats/page.tsx`

```typescript
'use client';

import { useEffect, useState } from 'react';
import { QueryMonitor } from '@/lib/queryMonitor';
import { ClientCache } from '@/lib/clientCache';
import { ServerCache } from '@/lib/serverCache';

export default function QueryStatsPage() {
  const [metrics, setMetrics] = useState<any>(null);
  const [projection, setProjection] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<string[]>([]);

  useEffect(() => {
    // Fetch stats every 30 seconds
    const interval = setInterval(() => {
      setMetrics(QueryMonitor.getMetrics(60));
      setProjection(QueryMonitor.getProjection());
      setRecommendations(QueryMonitor.getRecommendations());
    }, 30_000);

    // Initial load
    setMetrics(QueryMonitor.getMetrics(60));
    setProjection(QueryMonitor.getProjection());
    setRecommendations(QueryMonitor.getRecommendations());

    return () => clearInterval(interval);
  }, []);

  if (!metrics) return <div>Carregando estatísticas...</div>;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">📊 Query Analytics</h1>

      {/* Egress Estimation */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Card>
          <div className="text-2xl font-bold">{projection?.dailyGb}GB</div>
          <div className="text-gray-500">Projected Daily</div>
        </Card>
        <Card>
          <div className="text-2xl font-bold">{projection?.monthlyGb}GB</div>
          <div className="text-gray-500">Projected Monthly</div>
        </Card>
        <Card>
          <div className="text-2xl font-bold">{projection?.safeGb}GB</div>
          <div className="text-gray-500">Free Tier Limit</div>
        </Card>
        <Card>
          <div className={`text-2xl font-bold ${projection?.status.includes('OVER') ? 'text-red-600' : 'text-green-600'}`}>
            {projection?.status}
          </div>
          <div className="text-gray-500">Status</div>
        </Card>
      </div>

      {/* Cache Hit Rate */}
      <div className="bg-white p-4 rounded shadow mb-6">
        <h2 className="text-xl font-bold mb-4">📈 Cache Performance</h2>
        <div className="text-4xl font-bold text-blue-600">
          {(metrics?.cacheHitRate * 100).toFixed(0)}%
        </div>
        <p className="text-gray-500 mt-2">
          {metrics?.totalRequests} requests, {metrics?.errorCount} errors
        </p>
      </div>

      {/* Top Endpoints */}
      <div className="bg-white p-4 rounded shadow mb-6">
        <h2 className="text-xl font-bold mb-4">🔝 Top Endpoints by Egress</h2>
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">Endpoint</th>
              <th className="text-right py-2">Requests</th>
              <th className="text-right py-2">Total Bytes</th>
              <th className="text-right py-2">Avg Duration</th>
            </tr>
          </thead>
          <tbody>
            {metrics?.topEndpoints.map((ep: any) => (
              <tr key={ep.endpoint} className="border-b">
                <td className="py-2">{ep.endpoint}</td>
                <td className="text-right">{ep.count}</td>
                <td className="text-right">{(ep.totalBytes / 1024 / 1024).toFixed(1)}MB</td>
                <td className="text-right">{ep.avgDurationMs.toFixed(0)}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recommendations */}
      <div className="bg-yellow-50 border border-yellow-200 p-4 rounded">
        <h2 className="text-xl font-bold mb-4">💡 Recomendações</h2>
        <ul className="list-disc pl-6">
          {recommendations.map((rec, i) => (
            <li key={i} className="mb-2">{rec}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white p-4 rounded shadow border-l-4 border-blue-500">
      {children}
    </div>
  );
}
```

---

## ✅ VERIFICAÇÃO FINAL (2h)

```bash
# 1. Lint & Type Check
npm run lint
npm run type-check

# 2. Build
npm run build

# 3. Start e testar
npm run dev

# 4. Browser tests
# - Abra DevTools (F12) > Network
# - Visite http://localhost:3000/
# - Veja X-Cache header: HIT (depois 2ª vez)
# - Compression ratio na coluna Size deve mostrar ~95% reduction

# 5. Test RPCs work
# Supabase Dashboard > SQL Editor
SELECT * FROM public.get_events_minimal(5);
SELECT * FROM public.get_products_minimal(3);
SELECT * FROM public.dashboard_album_simple();

# 6. Test cache monitoring
# http://localhost:3000/admin/analytics/query-stats
# Deve mostrar cache hit rate aumentando
```

---

## 📊 ANTES vs DEPOIS

| Métrica | Antes | Depois | Melhora |
|---------|-------|--------|---------|
| **Landing Page Load** | 4-5MB | 200-300KB | 93% ↓ |
| **Tenants Directory** | 3-4MB | 150-200KB | 94% ↓ |
| **Cache Hit Rate** | 10-20% | 80-90% | 4-5x ↑ |
| **Daily Egress** | 120GB | 3-4GB | 30x ↓ |
| **Monthly Projected** | 184GB ❌ | 1.2GB ✅ | **FREE TIER** |

---

## 🚨 TROUBLESHOOTING

### Problema: RPC não funciona
```
Error: function public.get_events_minimal(integer) does not exist
→ Verificar no Supabase Dashboard se as funções foram criadas
→ Deve aparecer em "Functions" (menu esquerdo)
→ Rodar manualmente na SQL Editor para debug
```

### Problema: Gzip não está comprimindo
```typescript
// Verificar em DevTools > Network > Response Headers
// Deve ter: Content-Encoding: gzip
// Se não tiver, verificar if (request.headers.get('accept-encoding')?.includes('gzip'))
```

### Problema: Cache não invalidando
```typescript
// Após atualizar dados, rodar:
ServerCache.invalidatePattern('landing_*');
ClientCache.invalidatePattern('*'); // Clear all
```

---

## 📝 CHECKLIST FINAL

- [ ] RPCs criadas no Supabase
- [ ] dashboardPublicService.ts atualizado para usar RPCs
- [ ] /api/public/landing com gzip + ServerCache
- [ ] /api/public/tenants com gzip + ServerCache
- [ ] revalidate adicionado em páginas públicas
- [ ] ClientCache implementado em componentes autenticados
- [ ] Admin page de analytics criada
- [ ] QueryMonitor registrando todas as queries
- [ ] `npm run build` passando
- [ ] `npm run lint` sem warnings
- [ ] Manual testing (DevTools Network) validando compressão
- [ ] Metrics dashboard mostrando cache hit rate
- [ ] Documentação atualizada no README

---

## 🎯 PRÓXIMOS PASSOS (após implementação)

1. **Monitorar por 1 semana**
   - Acompanhar analytics dashboard
   - Validar que egress caiu para ~1-2GB/mês

2. **Fine-tune TTLs**
   - Se cache hit rate < 70%, aumentar TTL
   - Se conteúdo desatualizado, diminuir TTL

3. **Adicionar CDN** (opcional)
   - Se ainda precisar mais redução, usar Cloudflare/BunnyCDN
   - Cache static assets lá, reduz egress a zero

4. **Arquivar este documento**
   - Mover para `/docs/IMPLEMENTACAO_FREE_TIER_2026-03-21.md`
   - Usar como referência para futuras otimizações

