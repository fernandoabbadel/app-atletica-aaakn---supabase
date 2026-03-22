# 📖 REFERÊNCIA RÁPIDA: Free Tier Cache Implementation

Use este documento para rápidas lookups durante desenvolvimento.

---

## 🔗 Links Úteis

| Documento | Link | Propósito |
|-----------|------|----------|
| **Análise Estratégica** | ANALISE_COMPLETA_FREE_TIER_2026.md | Entender o problema + solução |
| **Implementação Step-by-Step** | PLANO_EXECUCAO_IMPLEMENTACAO.md | Seguir para fazer each step |
| **Arquitetura Visual** | ARQUITETURA_FREE_TIER_VISUAL.md | Ver diagramas de cache flow |
| **Exec Summary** | RESUMO_EXECUTIVO_FREE_TIER.md | Briefing para stakeholders |
| **Checklist** | CHECKLIST_IMPLEMENTACAO.md | Track progress |
| **This Document** | (você está aqui) | Quick reference |

---

## ⚡ Quick Copy-Paste Snippets

### Import ServerCache
```typescript
import { ServerCache } from '@/lib/serverCache';

// Usage
const data = await ServerCache.getOrSet(
  'key_name',
  () => fetchFromDB(),
  300_000 // TTL in ms (5 min)
);
```

### Import ClientCache
```typescript
import { useCachedData, ClientCache } from '@/lib/clientCache';

// In React component
const { data, loading, error } = useCachedData(
  'key_name',
  () => fetch('/api/endpoint').then(r => r.json()),
  86400000 // 24h
);
```

### Add gzip to API Route
```typescript
import { promisify } from 'util';
import zlib from 'zlib';

const gzip = promisify(zlib.gzip);

const json = JSON.stringify(data);
const compressed = await gzip(json);

return new Response(compressed, {
  headers: {
    'Content-Encoding': 'gzip',
    'Content-Type': 'application/json',
  },
});
```

### Add ISR to Page
```typescript
// At top of page component
export const revalidate = 3600; // 1 hour
export const dynamicParams = true;
```

### Record Query Metric
```typescript
import { QueryMonitor } from '@/lib/queryMonitor';

const start = Date.now();
const data = await fetchData();

QueryMonitor.recordQuery({
  endpoint: '/api/endpoint',
  method: 'GET',
  durationMs: Date.now() - start,
  payloadBytes: JSON.stringify(data).length,
  cacheHit: true,
  statusCode: 200,
  tenantId: 'public',
});
```

### Invalidate Cache
```typescript
import { ServerCache } from '@/lib/serverCache';
import { ClientCache } from '@/lib/clientCache';
import { revalidatePath } from 'next/cache';

// Server-side invalidation
ServerCache.delete('key_name');
ServerCache.invalidatePattern('events_*');
revalidatePath('/');

// Client-side invalidation
ClientCache.delete('key_name');
ClientCache.invalidatePattern('*');
```

---

## 🗂️ File Organization

```
src/
├── lib/
│   ├── serverCache.ts         ← In-memory cache (5-15 min TTL)
│   ├── clientCache.ts         ← localStorage cache (1-7 days TTL)
│   ├── queryMonitor.ts        ← Telemetry tracking
│   ├── dashboardPublicService.ts  ← Updated to use RPCs
│   └── ... (other services, now using RPCs)
│
├── app/
│   ├── api/
│   │   ├── public/
│   │   │   ├── landing/route.ts   ← Updated with cache + gzip
│   │   │   └── tenants/route.ts   ← Updated with cache + gzip
│   │   └── ...
│   │
│   ├── admin/
│   │   ├── analytics/
│   │   │   └── query-stats/page.tsx  ← Monitoring dashboard (NEW)
│   │   └── ...
│   │
│   ├── page.tsx               ← Add: export const revalidate = 43200
│   ├── ligas/page.tsx         ← Add: export const revalidate = 3600
│   ├── loja/page.tsx          ← Add: export const revalidate = 1800
│   ├── planos/page.tsx        ← Add: export const revalidate = 43200
│   ├── comunidade/page.tsx    ← Add: export const revalidate = 300
│   └── ...
│
└── components/
    └── ... (using useCachedData hook for auth'd data)

supabase/
└── migrations/
    └── 2026-03-21-tier-cache-rpc.sql  ← 7 new RPC functions
```

---

## 📊 Recommended TTL Values

| Layer | Where | TTL | Example |
|-------|-------|-----|---------|
| ISR | Pages (static) | 1-24h | Landing: 12h, Ligas: 1h |
| Server Cache | API routes | 5-15 min | /api/landing: 5min |
| RPC | DB functions | N/A | runs on-demand |
| Client Cache | localStorage | 1-7 days | Profile: 24h |

**Tuning**: If cache hit rate < 70%, increase TTL. If data stale, decrease.

---

## 🔍 Debugging Tips

### Check Cache Hit Rate
```javascript
// Browser console
fetch('/api/public/landing')
  .then(r => console.log('Cache:', r.headers.get('X-Cache')))
```

### Check Compression
```javascript
// Network tab DevTools → Response Headers
// Should see: Content-Encoding: gzip
// Size should be ~200KB vs 4MB original
```

### Monitor QueryMonitor
```javascript
// In browser console (if admin page created)
// http://localhost:3000/admin/analytics/query-stats
// Shows live metrics
```

### Clear All Caches
```typescript
// Server-side
ServerCache.clear();

// Client-side  
ClientCache.clear();

// ISR
revalidatePath('/', 'layout'); // Nuclear option
```

### Test RPC Works
```sql
-- Supabase Dashboard > SQL Editor
SELECT * FROM public.get_events_minimal(5);
-- Esperado: 5 rows with event data
```

### Verify Egress Saved
```bash
# Before optimization
# DevTools Network → Size column per request × 1000 visits

# After optimization  
# Should see 90-95% reduction
```

---

## ⚠️ Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| **RPC not found** | Not deployed to Supabase | Re-run SQL migration in Supabase SQL Editor |
| **gzip not in headers** | Middleware issue / compression disabled | Check Response headers, verify zlib import |
| **Cache not hit** | TTL too short or key mismatch | Check ServerCache stats, verify key name |
| **Stale data shown** | Cache TTL too long | Reduce TTL or add invalidation |
| **localStorage full** | 5MB limit exceeded | ClientCache auto-cleans, or user clears |
| **TypeScript error** | Import path wrong | Verify files in src/lib/, check tsconfig |
| **Build fails** | Mutation not committed | `git add -A && git commit` before npm run build |

---

## 📋 Pre-Commit Checklist

Before pushing to main:

```bash
# 1. Lint
npm run lint
# Expected: 0 errors (warnings OK if pre-existing)

# 2. Type check
npm run type-check  
# Expected: 0 errors

# 3. Build
npm run build
# Expected: completes successfully

# 4. Run locally
npm run dev
# Open browser, test a few pages, check Network tab

# 5. Commit
git add -A
git commit -m 'feat: free tier cache optimization (X of 4 sprints)'

# 6. Tag if major milestone
git tag -a vX.X-free-tier-incomplete -m 'Progress'

# 7. Push
git push origin main
```

---

## 🎯 Estimated Time per Component

| Component | Time | Difficulty |
|-----------|------|-----------|
| Deploy RPCs + indexes | 30 min | Easy |
| Create 3 cache files | 45 min | Easy |
| Update dashboardPublicService | 45 min | Medium |
| Add gzip to /api/landing | 1 hour | Medium |
| Add ISR to 6 pages | 45 min | Easy |
| Implement ClientCache | 2 hours | Hard |
| Create monitoring dashboard | 45 min | Medium |
| Testing & QA | 6 hours | Medium |
| **TOTAL** | **~16 hours** | **Mix** |

---

## 🧮 Math Reference

### Compression Ratio
```
Original: 4 MB = 4,000 KB
Gzipped:  200 KB
Ratio:    200 / 4000 = 5% (95% saved)
```

### Monthly Egress Projection
```
Requests/day:  1000
Payload/req:   200KB (after gzip)
Cache hit rate: 80%
Fresh requests: 1000 × 20% × 200KB = 40MB
Days:          30
Monthly:       40MB × 30 = 1,200 MB ✅ (vs 184GB before!)
```

### Cache Efficiency
```
Layer 1 (ISR):       60% reduction (no request)
Layer 2 (Server):    75% reduction (from server RAM)
Layer 3 (RPC):       95% reduction (DB aggregation)
Layer 4 (Client):    100% reduction (localStorage = 0 egress)

Overall: 1 - (0.4 × 0.25 × 0.05 × 0) ≈ 99%+
```

---

## 📞 Commands Cheat Sheet

```bash
# Development
npm run dev                   # Start dev server
npm run lint                  # Check ESLint
npm run type-check            # TypeScript validation
npm run build                 # Production build
npm run start                 # Start production server
npm run scan:unoptimized      # Find unoptimized images

# Git
git status                    # Check uncommitted changes
git add -A                    # Stage all changes
git commit -m "message"       # Commit changes
git push origin main          # Push to main
git tag -a vX.X -m "msg"     # Tag release

# Database (Supabase local dev)
supabase start                # Start local Supabase
supabase db migrations list   # Show migrations
supabase db migrations commit # Create migration

# Testing
npm run smoke                 # Run smoke tests
npm run smoke:ligas           # Run specific test
```

---

## 🎓 Learning Resources

If stuck:

1. **Next.js ISR**: https://nextjs.org/docs/app/building-your-application/data-fetching/incremental-static-regeneration
2. **Supabase Functions**: https://supabase.com/docs/guides/functions
3. **gzip Compression**: https://nodejs.org/api/zlib.html
4. **localStorage**: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
5. **This Project Docs**: PLANO_EXECUCAO_IMPLEMENTACAO.md

---

## ✨ Final Tips

- **Start with RPC deployment** - biggest impact, lowest risk
- **Test each layer independently** - don't stack all 4 at once
- **Monitor first week** - watch metrics dashboard closely
- **Tune TTLs gradually** - start conservative, adjust based on hit rates
- **Document findings** - share learnings with team
- **Celebrate wins** - free tier = huge savings! 🎉

---

## 🚀 You've Got This!

Quando surgir dúvida:
1. Check this page (quick reference)
2. Go to PLANO_EXECUCAO_IMPLEMENTACAO.md (detailed steps)
3. Look at example in ARQUITETURA_FREE_TIER_VISUAL.md (diagrams)
4. Review code snippets at top of this document

Good luck! 💪

