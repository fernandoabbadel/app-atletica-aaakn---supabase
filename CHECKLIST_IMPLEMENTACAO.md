# ✅ CHECKLIST: Implementação Free Tier Supabase

**Use este checklist durante a implementação para rastrear progresso**

---

## 📋 PRÉ-IMPLEMENTAÇÃO

- [ ] **Acesso Supabase**: Pode fazer login no dashboard Supabase
- [ ] **Node.js 18+**: `node --version` mostra v18 ou superior
- [ ] **Branch limpo**: `git status` mostra working tree clean
- [ ] **Build passa**: `npm run build` executa sem erros
- [ ] **Lint passa**: `npm run lint` sem erros (warnings OK)
- [ ] **Backup**: Commit final antes de começar (`git add . && git commit 'backup before cache implementation'`)

**Tempo estimado**: 30 min (setup)

---

## 🔧 SPRINT 1: RPC DEPLOYMENT (2h)

### 1.1 Deploy RPCs ao Supabase

**Checklist**:
- [ ] Abrir arquivo `supabase/migrations/2026-03-21-tier-cache-rpc.sql`
- [ ] Copiar TODO conteúdo (Ctrl+A na file)
- [ ] Ir para: Supabase Dashboard > SQL Editor > New Query
- [ ] Colar código SQL
- [ ] Clique "Execute"
- [ ] Aguardar 10-30 segundos

**Validação**:
```sql
-- Rodar no Supabase SQL Editor
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND (routine_name LIKE 'get_%' OR routine_name LIKE 'dashboard_%');

-- Esperado: Listar 7 funções:
-- ✅ get_events_minimal
-- ✅ get_products_minimal  
-- ✅ get_ligas_summary
-- ✅ get_posts_community_minimal
-- ✅ get_arena_rankings
-- ✅ get_dashboard_counts
-- ✅ dashboard_album_simple
```

- [ ] Verificar que retorna 7 funções
- [ ] Testar 1 RPC manualmente:
  ```sql
  SELECT * FROM public.get_events_minimal(5);
  -- Esperado: retorna 5 eventos com campos: id, titulo, data, hora, imagem, tenant_id, rsvp_count
  ```
- [ ] Registrar em commit: `git add -A && git commit 'feat: deploy RPCs to Supabase'`

**Tempo**: 30 min

### 1.2 Criar arquivos de cache (3 files)

- [ ] Criar `src/lib/serverCache.ts` (COPIAR do arquivo já criado)
  - Verificar compila sem erros: `npx tsc --noEmit src/lib/serverCache.ts`
  
- [ ] Criar `src/lib/clientCache.ts` (COPIAR do arquivo já criado)
  - Verificar compila: `npx tsc --noEmit src/lib/clientCache.ts`
  
- [ ] Criar `src/lib/queryMonitor.ts` (COPIAR do arquivo já criado)
  - Verificar compila: `npx tsc --noEmit src/lib/queryMonitor.ts`

**Validação**:
```bash
npm run lint
# Esperado: Sem erros (podem ter warnings de imports não usados yet)

npm run type-check
# Esperado: Sem erros TypeScript
```

- [ ] Registra commit: `git add -A && git commit 'feat: add cache layers (server, client, monitor)'`

**Tempo**: 45 min

### 1.3 Atualizar dashboardPublicService.ts

- [ ] Abrir arquivo: `src/lib/dashboardPublicService.ts`
- [ ] Encontrar seção de constants (linha ~20-50)
- [ ] Mudar:
  ```typescript
  // ANTES
  const DASHBOARD_EVENTS_FETCH_LIMIT = 40;
  
  // DEPOIS
  const DASHBOARD_EVENTS_FETCH_LIMIT = 5;
  ```
- [ ] Encontrar função `fetchDashboardData` ou similar
- [ ] Substituir queries SELECT diretos por chamadas RPC:
  ```typescript
  // ANTES
  const { data: events } = await supabase
    .from('eventos')
    .select(DASHBOARD_EVENTS_SELECT)
    .limit(DASHBOARD_EVENTS_FETCH_LIMIT);
  
  // DEPOIS
  const { data: events } = await supabase.rpc('get_events_minimal', {
    p_limit: DASHBOARD_EVENTS_FETCH_LIMIT
  });
  ```

- [ ] Fazer para todos os dados (events, products, album, ligas, posts)
- [ ] Testar compilação: `npm run type-check`
- [ ] Registar commit: `git add -A && git commit 'refactor: dashboardPublicService use RPCs instead of direct selects'`

**Tempo**: 45 min

**Sprint 1 Total**: 2h ✅

---

## 🛡️ SPRINT 2: COMPRESSION + SERVER CACHE (3h)

### 2.1 Atualizar /api/public/landing/route.ts

- [ ] Abrir arquivo: `src/app/api/public/landing/route.ts`
- [ ] Adicionar imports no topo:
  ```typescript
  import { ServerCache } from '@/lib/serverCache';
  import { QueryMonitor } from '@/lib/queryMonitor';
  import { promisify } from 'util';
  import zlib from 'zlib';
  
  const gzip = promisify(zlib.gzip);
  ```

- [ ] Modifique a função GET() para:
  ```typescript
  export async function GET(request: NextRequest) {
    const startTime = Date.now();
    
    try {
      // Tentar cache
      let data = ServerCache.get<any>('landing_data');
      let cacheHit = !!data;
      
      if (!data) {
        // Fetch novo com RPC
        data = await fetchDashboardViaNovosRpcs();
        ServerCache.set('landing_data', data, 300_000); // 5 min
      }

      // Comprimir
      const json = JSON.stringify(data);
      const compressed = await gzip(json);

      // Registra métrica
      QueryMonitor.recordQuery({
        endpoint: '/api/public/landing',
        method: 'GET',
        durationMs: Date.now() - startTime,
        payloadBytes: json.length,
        cacheHit,
        statusCode: 200,
        tenantId: 'public',
      });

      return new Response(compressed, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'Cache-Control': 'public, max-age=300',
          'X-Cache': cacheHit ? 'HIT' : 'MISS',
        },
      });
    } catch (error) {
      QueryMonitor.recordQuery({
        endpoint: '/api/public/landing',
        method: 'GET',
        durationMs: Date.now() - startTime,
        payloadBytes: 0,
        cacheHit: false,
        statusCode: 500,
        error: error instanceof Error ? error.message : 'Unknown'
      });
      
      return NextResponse.json({ error: 'Failed' }, { status: 500 });
    }
  }
  ```

- [ ] Criar nova função `fetchDashboardViaNovosRpcs()`:
  ```typescript
  async function fetchDashboardViaNovosRpcs() {
    const supabase = getSupabaseClient(); // verify function exists
    
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

- [ ] Test compilation: `npm run type-check`
- [ ] Registar commit: `git add -A && git commit 'feat: /api/public/landing with ServerCache + gzip compression'`

**Tempo**: 1h

### 2.2 Atualizar /api/public/tenants/route.ts

- [ ] Abrir arquivo: `src/app/api/public/tenants/route.ts`
- [ ] Adicionar mesmos imports que acima
- [ ] Aplicar mesmo padrão (ServerCache + gzip)
- [ ] TTL pode ser 10 min (vs 5 min para landing): `300_000 * 2`
- [ ] Test: `npm run type-check`
- [ ] Registar: `git commit 'feat: /api/public/tenants with cache + compress'`

**Tempo**: 45 min

### 2.3 Verificação ServerCache

- [ ] Abrir DevTools (F12)
- [ ] Console:
  ```javascript
  // No console do browser, devem estar disponíveis
  console.log('ServerCache loaded');
  
  // (ServerCache only available on server-side, but QueryMonitor is client visible)
  ```

- [ ] Network tab:
  - Visitr http://localhost:3000/api/public/landing
  - Headers da response devem ter:
    - `Content-Encoding: gzip`
    - `X-Cache: MISS` (primeira vez) ou `HIT` (segunda)
  - Response size deve ser ~200KB (gzipped)
  - Original size pode ser visto em Network tab > "size" column

- [ ] Primeira visita: `X-Cache: MISS`
  - [ ] Segunda visita (< 5min): `X-Cache: HIT` ✅

**Tempo**: 15 min

**Sprint 2 Total**: 3h ✅

---

## ⚡ SPRINT 3: ISR + REVALIDATE (2h)

### 3.1 Add revalidate em Páginas

**Páginas a atualizar**:

Para cada arquivo abaixo, adicione NO TOPO (depois imports):
```typescript
export const revalidate = 3600; // alterar valor por página
export const dynamicParams = true;
```

Páginas:
- [ ] `src/app/page.tsx` → revalidate = **43200** (12h)
- [ ] `src/app/ligas/page.tsx` → revalidate = **3600** (1h)  
- [ ] `src/app/loja/page.tsx` → revalidate = **1800** (30min)
- [ ] `src/app/planos/page.tsx` → revalidate = **43200** (12h)
- [ ] `src/app/comunidade/page.tsx` → revalidate = **300** (5min)
- [ ] `src/app/eventos/page.tsx` → revalidate = **600** (10min)
- [ ] Qualquer outra página pública

**Verificação após mudanças**:
```bash
npm run build

# Deve completar sem erros
# Build output deve mostrar:
# ✓ Compiled client and server successfully
# ○ Prerendering... (should see landing page being built)
```

- [ ] Registar: `git add -A && git commit 'feat: add ISR revalidate to public pages'`

**Tempo**: 45 min

### 3.2 Add Revalidate Tags (optional but recommended)

- [ ] Em serviços que fazem mutations (ex: admin pages), adicionar:
  ```typescript
  import { revalidatePath } from 'next/cache';
  
  // Após UPDATE/INSERT/DELETE
  revalidatePath('/');           // Revalidate landing
  revalidatePath('/ligas');      // Revalidate ligas
  ServerCache.delete('landing_data');
  ```

- [ ] Testar em admin (se possível)
- [ ] Registar: `git commit 'feat: add revalidatePath tags for invalidation'`

**Tempo**: 30 min

### 3.3 Build & Verify ISR

```bash
npm run build

# Deve ver output type:
# ○ Prerendered as 'static' /
# ○ Prerendered as 'static' /ligas
# etc

# Se vir "dynamic" ao lado desses, significa dinamicParams inadvertentemente ativo
# Se vir "routes" com valores grandes, quer dizer paginas estão sendo pre-rendered ✅
```

- [ ] Verify build completa sem erros
- [ ] Regional: `git commit 'chore: ISR build verified'`

**Tempo**: 15 min

**Sprint 3 Total**: 2h ✅

---

## 📦 SPRINT 4: CLIENT-SIDE CACHE (2h)

### 4.1 Usar ClientCache em Componentes

**Localize componentes chave**:

- [ ] `src/app/perfil/page.tsx` (se auth required)
- [ ] `src/app/dashboard/page.tsx`
- [ ] `src/components/UserProfileCard.tsx` (se exist)

**Para cada componente, fazer**:
```typescript
'use client'; // Necessário para client hook

import { useCachedData } from '@/lib/clientCache';

export default function Component() {
  const { data: profile, loading } = useCachedData(
    'user_profile',
    () => fetch('/api/profile').then(r => r.json()),
    86400000 // 24h
  );

  if (loading) return <Skeleton />;
  // ... usar data
}
```

- [ ] Atualizar ~5-10 componentes principais
- [ ] Test: `npm run type-check`  
- [ ] Registar: `git commit 'feat: add client-side cache to main components'`

**Tempo**: 1h

### 4.2 Add Invalidation Patterns

- [ ] Em componentes com mutations (ex: perfil edit):
  ```typescript
  import { ClientCache } from '@/lib/clientCache';
  
  async function updateProfile(data) {
    await api.put('/api/profile', data);
    ClientCache.delete('user_profile');
    // Refresh in background
    revalidateQuery('user_profile');
  }
  ```

- [ ] Test: Atualizar perfil, verificar que carrega novo dado
- [ ] Registar: `git commit 'feat: add ClientCache invalidation on mutations'`

**Tempo**: 45 min

**Sprint 4 Total**: 2h ✅

---

## 🔍 SPRINT 5: MONITORING (1h)

### 5.1 Create Admin Analytics Page (optional)

- [ ] Create file: `src/app/admin/analytics/query-stats/page.tsx`
- [ ] Copy code from PLANO_EXECUCAO_IMPLEMENTACAO.md section "5.1 Criar Admin Page"
- [ ] Update imports if needed
- [ ] Test: `npm run type-check`
- [ ] Registar: `git commit 'feat: add query analytics admin page'`

**Tempo**: 45 min

### 5.2 Verify QueryMonitor Integration

- [ ] Open browser console
- [ ] Make requests to your API endpoints
- [ ] Verify QueryMonitor is being called (pode add logs de debug)
- [ ] Admin page should show metrics

**Tempo**: 15 min

**Sprint 5 Total**: 1h ✅

---

## 🧪 QA & VERIFICATION (6h)

### Build Verification

- [ ] `npm run lint`
  - [ ] Zero erros (warnings OK se já existentes)
  
- [ ] `npm run type-check`
  - [ ] Zero TypeScript erros
  
- [ ] `npm run build`
  - [ ] Build completa sem erros
  - [ ] Warning sobre LCP/Images são OK

**Time**: 30 min

### Local Testing

- [ ] `npm run dev`
  
- [ ] Open DevTools (F12) > Network tab

- [ ] Visita http://localhost:3000
  - [ ] Check response headers:
    - [ ] `Content-Encoding: gzip` (present)
    - [ ] `X-Cache: MISS` (first load)
  - [ ] Response size in DevTools (compressed, should be ~200KB)
  - [ ] Page loads in < 1 second

- [ ] Visita landing novamente (< 5min)
  - [ ] Check `X-Cache: HIT` ✅
  - [ ] Response still gzipped
  - [ ] Faster load (from cache)

- [ ] Visita outros endpoints:
  - [ ] `/api/public/tenants` - deve ter gzip
  - [ ] `/api/public/landing` - deve ter cache

**Time**: 1.5h

### Browser Console Testing

```javascript
// Open Console (F12)

// Test ClientCache (if logged in)
await fetch('/api/profile').then(r => r.json()).then(data => {
  console.log('Profile fetched:', data);
  // Second call should be from cache
});

// Simulate second visit (should be faster)
// Close tab, reopen page - should load from localStorage
```

**Time**: 1h

### Supabase Dashboard Verification

- [ ] Supabase Dashboard > Monitoring (if available)
- [ ] Check that database connections are lower (RPC aggregation working)
- [ ] Check no errors in Function executions

**Time**: 30 min

### Content Verification

- [ ] Landing page renders correctly (no visual breaks)
- [ ] Ligas page shows expected data
- [ ] Loja products display
- [ ] Comunidade posts load

**Time**: 1h

### Performance Benchmark (before/after)

```bash
# Before optimization (current main branch)
# Screenshot network waterfall

# After optimization (current branch)
# Screenshot network waterfall

# Compare:
# - Total request time
# - Number of requests
# - Total data transferred
# - Cache hit rate
```

**Time**: 1h

### Final Commit & Tag

- [ ] All tests passing
- [ ] Commit final changes: `git commit 'chore: qa completed for free tier cache implementation'`
- [ ] Tag release: `git tag -a v1.0-free-tier -m 'Free tier egress optimization implementation'`
- [ ] Push: `git push origin main --tags`

**Time**: 30 min

**QA Total**: 6h ✅

---

## 📊 FINAL VALIDATION

After deployment, verify metrics:

- [ ] **Egress Tracking** (checklist daily for 1 week):
  - [ ] Day 1: Monitor QueryMonitor dashboard
  - [ ] Day 2: Verify cache hit rate > 70%
  - [ ] Day 3: Check projected monthly < 1.5GB
  - [ ] Day 4-7: Stable metrics collection

- [ ] **Performance Metrics**:
  - [ ] Landing page load < 500ms
  - [ ] API responses < 100ms with cache
  - [ ] No 5xx errors

- [ ] **User Reports**:
  - [ ] No complaints about stale data
  - [ ] Pages feel snappy
  - [ ] Offline access works (if implemented)

---

## 🎯 SUCCESS CRITERIA

✅ **Implementation Complete** when:

1. All 4 build checks pass:
   - [ ] `npm run lint` → 0 errors
   - [ ] `npm run type-check` → 0 errors
   - [ ] `npm run build` → succeeds
   - [ ] `npm run dev` → no runtime errors

2. Cache is working:
   - [ ] First request: `X-Cache: MISS`, gzipped
   - [ ] Second request: `X-Cache: HIT`, gzipped
   - [ ] Cache appears in response headers
   - [ ] CompressionRatio > 90%

3. Monitoring active:
   - [ ] Admin page shows metrics
   - [ ] QueryMonitor tracking requests
   - [ ] Cache hit rate visible

4. Performance improved:
   - [ ] Landing page < 500ms (vs 2-3s before)
   - [ ] API calls < 100ms (vs 200-500ms before)

5. Egress projection:
   - [ ] Monthly projected < 1.5GB (vs 184GB before)
   - [ ] Within free tier safe margin

---

## 📝 NOTES

**If you hit issues**:

1. **RPC not found**:
   - Verify in Supabase Dashboard > Functions (left menu)
   - Re-run SQL migration if needed
   - Check function permissions (should have GRANT EXECUTE)

2. **gzip not working**:
   - Check response header: `Content-Encoding: gzip`
   - Verify browser accepts gzip (most do)
   - Check zlib import works

3. **Cache not invalidating**:
   - Verify ServerCache.delete() is called
   - Check invalidation happens before response
   - Test manually: `ServerCache.clear()`

4. **TypeScript errors**:
   - Run `npm run type-check --verbose` for details
   - Check imports are correct
   - Verify lib files are in src/lib/

---

**Total Implementation Time: ~16 hours** ✅

**Estimated Timeline: 4 days (1 dev)** ✅

**Expected Result: Free tier sustainable indefinitely** ✅

