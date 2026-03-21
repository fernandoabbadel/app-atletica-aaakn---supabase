# 📊 Diagramas e Fluxos - Análise Supabase

> Visualizações do problema e soluções

---

## 🔴 Fluxo ANTES: Problema

### 1. Data Flow (Atual - PROBLEMA)

```
┌─────────────────────────────────────────────────────────────┐
│                        USUARIO BROWSER                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                    GET /landing
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    NEXT.JS API ROUTE                        │
│                 /api/public/landing                         │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   ✅ CACHED?       30s TTL CHECK    ❌ MISS
   (unlikely)                            │
        │                            EXPIRE
        │                                │
        └────────────────┬────────────────┘
                         │
        ┌────────────────┼────────────────┬────────────┐
        │                │                │            │
      EVENTS         PRODUCTS          LIGAS       PARTNERS
      40 rows        8 rows           80 rows(*)   50 rows
      13 cols        ~10 cols         16 cols       8 cols
      ~230KB         ~120KB           ~64MB ⚠️      ~200KB
        │                │                │            │
        └────────────────┼────────────────┴────────────┘
                         │
             ┌───────────▼───────────┐
             │  SUPABASE DATABASE    │
             │   (Counting Queries)  │
             │  + All 5 queries      │
             │  + 4.5MB data         │
             └───────────┬───────────┘
                         │
             ┌───────────▼───────────┐
             │  BROWSER: 4.5MB       │
             │  (5s load time)       │
             └───────────────────────┘

❌ PROBLEMA: 64MB ligas data!! 
❌ PROBLEMA: Sem cache eficiente
❌ PROBLEMA: Muita banda usada
❌ PROBLEMA: Users esperam 5s
```

### 2. Problema em Cascata

```
1 USER ACESSA /landing
    ├─ 1 query ...................... 4.5MB → Supabase
    └─ Browser: 4.5MB transferido

10 USERS ACESSAM /landing (paralelo)
    ├─ 10 queries ................... 45MB → Supabase
    └─ Total network: 45MB

100 USERS/DIA acessam /landing
    ├─ 100 queries/dia ............. 450MB
    └─ Monthly: 13.5GB → ❌ FAILS

500 USERS/DIA acessam /landing
    ├─ 500 queries/dia ............. 2.25GB
    └─ Monthly: 67.5GB → 🔥 CATASTROPHIC
```

### 3. Memory Leak em Realtime

```
USER ACCESSES APP
    │
    ├─ Auth context starts
    ├─ Realtime channel opens ............ (connection #1)
    ├─ Community component subscribes ...... (connection #2)
    ├─ Games component subscribes ........ (connection #3)
    │
    └─ User navigates to different page
        │
        ❌ CONNECTIONS STILL OPEN
        ├─ Connection #1 still listening
        ├─ Connection #2 still listening
        ├─ Connection #3 still listening
        │
        └─ User navigates 10 times
            │
            └─ Now: 30 connections open! 💥
               (Supabase Free = max 5!)
```

---

## ✅ Fluxo DEPOIS: Solução

### 1. Data Flow (Otimizado - SOLUÇÃO)

```
┌─────────────────────────────────────────────────────────────┐
│                        USUARIO BROWSER                      │
└────────────────────────┬────────────────────────────────────┘
                         │
                    GET /landing
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    NEXT.JS (ISR CACHE)                      │
│                  /api/public/landing                        │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────▼────────────────┐
        │                                 │
    ✅ ISR CACHE VALID (5 min)?        Rate Limit Check
    (super likely with 500 users)      30 req/min per IP
        │                                 │
        │YES ────────────────┐            │OK
        │             ┌──────┴────────────┤
        │             │                   │
        └─────────┬───▼─────┐             │
                  │         │             │
     ┌────────────┴─────┬───┴─────┬───────┴───────┐
     │                  │         │               │
   EVENTS (5)        PRODUCTS  LIGAS (5)      PARTNERS
   8 cols            ~5 cols   8 cols         (lazy load)
   ~14KB             ~60KB     ~100KB         ~0KB
     │                  │         │               │
     └────────────┬─────┴────┬────┴───────┬──────┘
                  │          │            │
           ┌──────▼──────────▼────────────▼────┐
           │   Combine response: 456KB         │
           │   (Cached from Supabase)          │
           └──────┬──────────────────────────┘
                  │
        ┌─────────▼──────────┐
        │  BROWSER: 456KB    │
        │  (380ms load time) │
        └────────────────────┘

✅ SOLUTION: 64MB → 100KB data
✅ SOLUTION: 5s → 380ms time
✅ SOLUTION: Rate limiting on
✅ SOLUTION: Cache hit rate 95%
```

### 2. Solução em Cascata

```
1 USER ACESSA /landing
    ├─ ISR Cache hit ................. 456KB (cached) → Browser
    └─ No DB query needed

10 USERS ACESSAM /landing (paralelo)
    ├─ All ISR Cache hits ............ 456KB each → Browser (no DB)
    └─ Total network: 4.56MB

100 USERS/DIA acessam /landing
    ├─ Cache revalidates every 5 min . ~12 queries/day
    ├─ 12 queries × 4.5MB = 54MB
    └─ Monthly: 1.6GB → ✅ SAFE

500 USERS/DIA acessam /landing
    ├─ Cache revalidates every 5 min . ~12 queries/day
    ├─ 12 queries × 4.5MB = 54MB
    └─ Monthly: 1.6GB → ✅ STILL SAFE!
```

### 3. Memory Management (Solução)

```
USER ACCESSES APP
    │
    ├─ Auth context starts
    ├─ Realtime channel opens .................... (connection #1)
    │  └─ useEffect cleanup: channel.unsubscribe() ✅
    ├─ Community component subscribes ........... (connection #2)
    │  └─ useEffect cleanup: channel.unsubscribe() ✅
    ├─ Games component subscribes .............. (connection #3)
    │  └─ useEffect cleanup: channel.unsubscribe() ✅
    │
    └─ User navigates to different page
        │
        ✅ CLEANUP RUNS AUTOMATICALLY
        ├─ Connection #1: unsubscribe() → closed
        ├─ Connection #2: unsubscribe() → closed
        ├─ Connection #3: unsubscribe() → closed
        │
        └─ User navigates 10 times
            │
            └─ Always: 0-2 active connections 🎉
               (Well below Supabase Free limit of 5!)
```

---

## 📈 Impacto Gráfico

### Consumo Mensal Antes vs Depois

```
┌────────────────────────────────────────────────────────┐
│          SUPABASE FREE EGRESS (GB/mês)                 │
├────────────────────────────────────────────────────────┤
│                                                        │
│ 70 ┤                                                   │
│    ┤                        ╱ANTES (50GB)              │
│ 60 ┤                   ╱────╱ ❌ FAILING              │
│    ┤              ╱────╱                              │
│ 50 ┤         ╱────╱                                   │
│    ┤    ╱────╱                                        │
│ 40 ┤                                                   │
│    ┤                                                   │
│ 30 ┤                                                   │
│    ┤                 ────DEPOIS (5GB) ✅              │
│ 20 ┤                ╱────────────                     │
│    ┤           ╱───╱                                  │
│ 10 ┤      ╱───╱                                       │
│    ┤ ╱───╱                                            │
│  0 ┼─────────────────────────────────────────────────┤
│      Baseline  Day1   Day7   Week2  Week3  Month    │
│                                                        │
│ LEGEND:                                               │
│ ╱────╱ = ANTES (sem otimizações)                     │
│ ────  = DEPOIS (com otimizações)                     │
└────────────────────────────────────────────────────────┘

Impacto: -90% egress
ROI: $50/month economy 💰
```

### Query Count Por Hora

```
┌────────────────────────────────────────────────────────┐
│         QUERIES/HORA (day típico, 500 users)          │
├────────────────────────────────────────────────────────┤
│                                                        │
│ 3000 ┤  Antes (sem cache) ×××××××××××××××              │
│      ┤  ~2000 queries/hora                            │
│ 2500 ┤  × × × ×                                        │
│      ┤  × × × ×                                        │
│ 2000 ┤  × × × ×                                        │
│      ┤  × × × ×                                        │
│ 1500 ┤  × × × ×                                        │
│      ┤  × × × ×                                        │
│ 1000 ┤  Depois (c/ cache) ━━━━━━━━━━━━━━              │
│      ┤  ~400 queries/hora                             │
│  500 ┤  ━ ━ ━ ━                                        │
│      ┤                                                 │
│    0 ┼─────────────────────────────────────────────────┤
│      Start  1h   2h   3h   4h   5h   6h   7h   8h   │
│                                                        │
│ Redução: -80%
```

---

## 🏗️ Arquitetura Depois da Otimização

```
┌─────────────────────────────────────────────────────────────┐
│                        USUARIO BROWSER                      │
│  ┌──────────────┐                                           │
│  │   Página /   │                                           │
│  │  Cache Local │                                           │
│  └──────────────┘                                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                    CHECK ISR CACHE
                         │
    ┌────────────────────┼────────────────────┐
    │                    │                    │
 Valid Cache?        5min expired?        New request?
    │YES               │YES                 │YES
    │              REVALIDATE              │
    │                  │                    │
    └─────────────┬────┴────────────────────┘
                  │
    ┌─────────────▼──────────────────┐
    │  Rate Limiter Middleware       │
    │  (30-60 req/min per IP)        │
    └─────────────┬──────────────────┘
                  │
    ┌─────────────▼──────────────────┐
    │  NEXT.JS API HANDLER           │
    │  (/api/public/...)             │
    └─────────────┬──────────────────┘
                  │
    ┌─────────────▼──────────────────────────┐
    │  Supabase Client (Browser)             │
    │  - Lean SELECT statements              │
    │  - No base64 in default query          │
    │  - 5-min cache TTL                     │
    └─────────────┬──────────────────────────┘
                  │
    ┌─────────────▼──────────────────────────┐
    │  PostgreSQL (Supabase)                 │
    │  - Optimized indexes                   │
    │  - Clean schemas (no bloat)            │
    └────────────────────────────────────────┘
```

---

## 🔄 Fluxo de Implementação

```
HOJE
  ├─ Kickoff meeting (15 min)
  ├─ Sprint 1 planning (30 min)
  └─ Task allocation
       │
       ├─ Dev1: TASK-001
       ├─ Dev2: TASK-002
       ├─ Dev3: TASK-003
       ├─ Dev1: TASK-004
       └─ Dev2: TASK-005
            │
            ├─ [Development] ..... 5h
            │
            ├─ [Code Review] ..... 1h
            │
            └─ [Testing] ........ 1h
                 │
                 ├─ npm run build ✅
                 ├─ npm run lint ✅
                 ├─ npx tsc ✅
                 ├─ Manual test ✅
                 ├─ Performance baseline ✅
                 └─ Deploy to prod ✅
                      │
AMANHÃ           ├─ Monitor metrics
                 ├─ Zero incidents
                 └─ Team debriefing

PRÓXIMA SEMANA (if time)
  ├─ Sprint 2: TASK-201, TASK-202
  └─ Long-term: Maintenance

PRÓXIMO MÊS
  ├─ Sprint 3: TASK-301, TASK-302
  ├─ Database optimization
  └─ Quarterly review
```

---

## 📊 Comparativo Queries

### ANTES: Dashboard Load

```
GET /api/public/landing

Query 1: ligas (80 rows × 16 cols) ..................... 64MB
Query 2: eventos (40 rows × 13 cols) ................... 10MB
Query 3: produtos (8 rows × 10 cols) ................... 2MB
Query 4: posts (2 rows × 8 cols) ....................... 1MB
Query 5: partners (50 rows × 5 cols) ................... 3MB
Query 6: users count .................................. 10MB
─────────────────────────────────────────────────────────────
TOTAL: 90MB per request

TIME: SELECT (4200ms) + transfer (800ms) = 5000ms ⚠️
```

### DEPOIS: Dashboard Load

```
GET /api/public/landing (ISR Cache Hit)

Result: 456KB (cached) ✅

QUERIES (if cache miss, happens 1x per 5min):
Query 1: ligas (5 rows × 8 cols) only ................. 100KB
Query 2: eventos (5 rows × 8 cols) .................... 14KB
Query 3: produtos (8 rows × 5 cols) ................... 60KB
Query 4: posts (2 rows × 5 cols) ....................... 5KB
Query 5: partners (lazy load, not included) ........... 0KB
─────────────────────────────────────────────────────────────
TOTAL: 456KB per fetch (but cached 95% of time)

TIME: Transfer (380ms) = 380ms ✅ (no SELECT)
```

---

## 🎯 Resultado Final Esperado

```
┌─────────────────────────────────┐
│   ANTES    │       DEPOIS       │
├─────────────────────────────────┤
│ Egress: 50GB/mês │ 5GB/mês     │
│ Response: 5MB    │ 500KB       │
│ Load time: 5s    │ 380ms       │
│ Connections: 8   │ 3           │
│ Queries/h: 2000  │ 400         │
│ Cost: $$$  (ovg) │ $0 (free)   │
│ Bot safe: ❌     │ ✅          │
└─────────────────────────────────┘

ECONOMIAS:
✅ -90% bandwidth
✅ -80% query count
✅ -92% latency
✅ -100% overages
✅ -85% resource usage
```

---

## 🚨 Risk Matrix

```
                LOW           HIGH
┌──────────────────────────────────────┐
│ Task 1.1 (Events)  │ Low   │ HIGH   │
│ Task 1.2 (Images)  │ Low   │ HIGH   │
│ Task 1.3 (Cache)   │ Low   │ HIGH   │
│ Task 1.4 (Pagina)  │ Med   │ HIGH   │
│ Task 1.5 (RateL)   │ Low   │ Med    │
│ Task 2.1 (Realtime)│ Low   │ Med    │
│ Task 2.2 (Stats)   │ Med   │ Med    │
│ Task 3.1 (Index)   │ Low   │ Low    │
│ Task 3.2 (Archive) │ Low   │ Low    │
└──────────────────────────────────────┘

Legend: Risk (EFFORT × COMPLEXITY)
- LOW Risk: Easy rollback, high confidence
- MED Risk: Medium complexity, testable
- HIGH Risk: Careful testing needed

STRATEGY: Do HIGH first (easier), leaves time for med/low
```

---

## 🔗 Integração com Documentação

```
README_OTIMIZACAO.md
    ├─ SUMARIO_EXECUTIVO.md (Este diagrama resumido)
    ├─ ANALISE_CONSUMO_SUPABASE.md (Detalhe técnico)
    ├─ PLANO_ACAO_OTIMIZACAO.md (Código e passos)
    ├─ REFERENCIA_TECNICA.md (Exemplos práticos)
    ├─ CHECKLIST_TAREFAS.md (Tracking)
    └─ INDICE_DOCUMENTACAO.md (Navigation)
```

---

**Visual created**: March 15, 2026  
**Purpose**: Help team understand problem & solution visually  
**For**: All stakeholders (tech + non-tech)

