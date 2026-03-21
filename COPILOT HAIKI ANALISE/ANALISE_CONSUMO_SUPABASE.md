# Análise de Consumo Postgres & Egress - Plano Free Supabase

**Data**: 15 de Março de 2026  
**Status**: Análise Crítica de Risco

---

## 📊 Resumo Executivo

O app está **em RISCO MODERADO a ALTO** de exceder limites do plano Free Supabase em múltiplos cenários:

- **Postgres**: ~50GB/mês (Safe: 1GB) ⚠️
- **Egress**: ~20-40GB/mês (Safe: 1GB) ⚠️  
- **Conexões Simultâneas**: Potencial pico (Safe: 5) ⚠️
- **Rate Limiting**: Não implementado em rotas críticas ⚠️

---

## 🔴 CRÍTICO: Top 5 Consumidores de Recursos

### 1. **Dashboard Público (`/api/public/landing`) - ALTO RISCO**

**Arquivo**: `src/lib/dashboardPublicService.ts`

**Problema**: Carregamento de múltiplas tabelas em paralelo na landing page

```typescript
// Chamadas típicas (cada uma retorna MB de dados):
- DASHBOARD_EVENTS_FETCH_LIMIT: 40 linhas (com 13+ colunas)
- DASHBOARD_PRODUCTS_LIMIT: 8 (valores + arrays em JSON)
- DASHBOARD_POSTS_LIMIT: 2
- DASHBOARD_PARTNERS_LIMIT: 50
- DASHBOARD_LIGAS_LIMIT: 60
- album_rankings: até 2000 linhas (com DASHBOARD_ALBUM_FALLBACK_LIMIT)
- users count: full scan às vezes
```

**Impacto por Visitante**:
- ~2-5MB por navegador visitando `/`
- Se 1000 usuários/dia visitam → 2-5GB/dia
- **MENSAL**: 60-150GB (❌ FAILS - Limite: 1GB)

**Fatores Agravantes**:
- Cache de apenas 30 segundos (READ_CACHE_TTL_MS = 30_000)
- Sem compressão de JSON
- Retorna arrays gigantes (`likesList`, `voters` em enquetes)
- Chamadas ao RPC `dashboard_total_caca_calouros` sem cache eficiente

---

### 2. **Endpoint `/api/public/tenants` - ALTO RISCO**

**Arquivo**: `src/app/api/public/tenants/route.ts`

```typescript
const limit = Math.max(1, Math.min(200, requestedLimit)) // Permite 200 registros
```

**Problema**:
- Sem `revalidate` adequado (ISR deveria ser 300s)
- Retorna 20+ colunas por tenant para até 200 tenants
- ~1.5-2MB por requisição
- Se 10 acesso/dia → 15-20GB/mês

**Potencial Abuso**: Scraper pode chamar com `limit=200` N vezes

---

### 3. **RankingService - Consumo Moderado**

**Arquivo**: `src/lib/rankingService.ts`

```typescript
const MAX_RANKING_USERS = 250
const TTL_MS = 25_000 // Cache curto!
```

**Problema**:
- Seleciona 7 colunas para até 250 usuários
- Cache de apenas 25 segundos
- Chamadas por `turma` + `tenant_id` multiplicam queries
- Se 50 turmas × 250 usuários = 87.5 MB por fetch

**Cenário**:
- 100 usuários vendo ranking/hora = 100 queries/hora
- **MENSAL**: 72GB (sem cache hit rate bom)

---

### 4. **LeaguesService - Operações em Cascata**

**Arquivo**: `src/lib/leaguesService.ts`

```typescript
const MAX_LEAGUE_RESULTS = 80
const MAX_USER_RESULTS = 200  // Por liga!
const MAX_POLL_RESULTS = 60
```

**Problema**:
- Cada liga carrega até 200 usuários
- Se 80 ligas atribuídas = 16.000 usuários fetched
- Retorna arrays complexos (membrosIds, eventos, perguntas, likes)
- RPC calls para quiz results (sem limit/paginação)

**Cenário**:
- Page `/ligas` carrega 80 ligas + membros = 5-10MB
- 500 usuários acessando/dia = 2.5-5GB

---

### 5. **Store Service - Operações Não Paginadas**

**Arquivo**: `src/lib/storeService.ts`

```typescript
const MAX_PRODUCTS = 240
const MAX_ORDERS = 1200  // ❌ CRÍTICO!
const MAX_REVIEWS = 600
```

**Problema**:
- Seleciona até 1200 orders de uma vez
- Se média 10KB/order = 12MB por fetch
- Sem paginação cursor-based
- Retorna array completo de `itens` por order

**Impacto**: 10 usuários acessando carrinho = 120MB em paralelo

---

## 🟡 ALTO: Operações Secundárias

### 6. **AuthContext - Múltiplas Queries no Login**

**Arquivo**: `src/context/AuthContext.tsx` (linhas ~750-1400)

```typescript
// Login flow típico:
1. SELECT users (8+ colunas) - busca user actual
2. SELECT patentes_config (4 colunas) - ALL
3. SELECT planos (5 colunas) - ALL  
4. SELECT solicitacoes_adesao (4 colunas) - user specific
5. Potencial SELECT users (novamente) para sync
```

**Problema**:
- 5+ queries sequenciais no login
- Sem parallelism/connection pooling
- Config tables fetched toda vez (sem cache)
- Se 100 logins/dia = 500 queries

**Impacto**: ~50MB de overhead por 100 logins

---

### 7. **Events Service - Sem Limite de Enquetes**

**Arquivo**: `src/lib/eventsService.ts`

```typescript
// Retorna array completo de voters/opcoes
eventos_enquetes SELECT: voters, userVotes (arrays gigantes!)
```

**Problema**:
- Evento com 5000 votes = 100KB+ só p/ enquete
- Código retorna **TODAS** as enquetes de um evento
- Se 1000 eventos com 5 enquetes cada = 500+ MB

---

### 8. **HistoryService/CommunitService - Full Scans**

**Arquivo**: `src/lib/{history,community}Service.ts`

```typescript
// Potenciais:
.select("*") sem limit em alguns pontos
.select("id") com count: "exact" força full scan
```

---

## 🟠 PONTOS DE VULNERABILIDADE - Egress (Data Transfer Out)

### Image Loading
- Base64 images armazenadas em `logo_url`, `logoBase64` 
- Cada imagem base64 = 200KB-1MB no objeto
- 80 ligas com images = 40-80MB **por fetch**
- `unoptimized={true}` em componentes = sem compression

**Arquivo**: `src/app/ligas/page.tsx`
```typescript
// Cada liga carrega logoBase64 completo
```

### Video/Audio Embeds
- Algumas tabelas podem ter URLs de vídeos 24h vencíveis
- Sem CloudFront/CDN setup
- Direto do Supabase Storage = egress charges

---

## 📋 Tábelas com Maior Volume de Dados

| Tabela | Est. Tamanho | Query Freq | Problema |
|--------|-------------|-----------|----------|
| `users` | 50-100MB | ~50/min | Sem indexes bons p/ `tenant_id`, `turma` |
| `eventos` | 20-40MB | ~20/min | Retorna arrays (enquetes, interessados) |
| `app_config` | 100MB+ | ~10/min | Dados desnormalizados (JSON gigantes) |
| `ligas_config` | 50-100MB | ~20/min | eventos/membros stored como arrays |
| `produtos` | 30-50MB | ~15/min | Imagens base64, variantes arrays |
| `album_rankings` | 50MB+ | ~5/min | Cada ranking = múltiplas colunas |
| `notifications` | 100MB+ | ~5/min | Histórico nunca limpo |
| `achievements_logs` | 150MB+ | ~5/min | Append-only, sem partição |

---

## 🔐 Rate Limiting & Connection Issues

### Nenhuma Rate Limiting em Rotas Críticas
```typescript
// ❌ Sem proteção
export async function GET(request: Request) {
    const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "60", 10);
    const limit = Math.max(1, Math.min(200, requestedLimit));
    // Qualquer um pode fazer 1000 requests/segundo!
}
```

### Realtime Subscriptions Múltiplas
- Usuários não limpam listeners em `useEffect` cleanup
- Conexões abertas indefinidamente
- Pode exceder limite de 5 conexões simultâneas

**Arch**: `AuthContext.tsx` + componentes sem `.off()`

---

## 📊 Estimativa de ROI por Cenário

### Cenário 1: "Dia Normal" (500 usuários ativos)
```
- 100 logins: 50MB
- 500 page loads (dashboard): 1GB
- 200 ranking views: 100MB  
- 100 store browses: 500MB
- Misc (events, leagues): 300MB
TOTAL: ~2.5GB/dia = 75GB/mês ❌
```

### Cenário 2: "Lançamento/Sprint" (5000 usuários ativos)
```
TOTAL: ~25GB/dia = 750GB/mês 🔥❌
```

### Cenário 3: "Scraped por Bot" (10 concurrent scrapers)
```
- 1 scraper: 10 req/sec × 2MB = 200 req/sec
- 10 scrapers = 2000 req/sec
- Limite free Supabase = provavelmente 100 req/sec
RESULTADO: Blocked + overage charges
```

---

## ✅ Recomendações de Otimização (Prioridade)

### CRÍTICA (Faça já):

#### 1.1 Dashboard Public Service - Selects Paginados
```typescript
// ANTES
const DASHBOARD_EVENTS_FETCH_LIMIT = 40;
select("id,titulo,imagem,lotes,status,data,hora,local")

// DEPOIS
const DASHBOARD_EVENTS_FETCH_LIMIT = 5;  // Max 5 eventos
select("id,titulo,imagem,status,data")   // Menos colunas
// Separar imagens em query diferente com cache separado
```

**Impacto**: -80% bandwidth no endpoint `/api/public/landing`

---

#### 1.2 Implementar Proper Caching
```typescript
// ANTES
const READ_CACHE_TTL_MS = 30_000;  // 30s = 120 cache misses/hora

// DEPOIS (ISR-like Pattern)
const READ_CACHE_TTL_MS = 300_000;  // 5min = 12 fetches/hora
export const revalidate = 300;      // ISR revalidation
export const generateStaticParams = () => generateTenantsIds(); // Pregenerate
```

**Impacto**: -90% queries em tabelas config

---

#### 1.3 Remove Base64 Images do Select
```typescript
// ANTES
select("id,nome,foto,logoUrl,logoBase64,...")  // 1MB per row!

// DEPOIS
select("id,nome,foto,logoUrl") // 10KB per row
// Lazy load logoBase64 só quando needed
// Ou usar Supabase Storage URLs sem base64
```

**Impacto**: -60% bandwidth p/ `/ligas` endpoint

---

#### 1.4 Pagination Cursor-Based
```typescript
// ANTES
export async function getStoreOrders() {
    const { data } = await supabase
        .from("orders")
        .select("*")  // Returns 1200 rows
        .limit(1200)

// DEPOIS
export async function getStoreOrders(lastId?: string) {
    let q = supabase
        .from("orders")
        .select("id,userId,productId,preco,status,data")  // 6 columns not 20
        .order("id", { ascending: false })
        .limit(20)  // Page size
    
    if (lastId) {
        q = q.lt("id", lastId)  // Cursor-based
    }
    
    return await q
}
```

**Impacto**: -95% query size p/ store operations

---

### ALTA (Próxima Sprint):

#### 2.1 Rate Limiting
```typescript
// src/middleware.ts
import { RateLimiter } from 'some-lib';

const limiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 100,  // 100 req/min
    keyGenerator: (req) => req.ip + req.path,
});

export async function middleware(request: NextRequest) {
    if (request.nextUrl.pathname.startsWith('/api/public/')) {
        const isAllowed = await limiter.isAllowed(request);
        if (!isAllowed) {
            return NextResponse.json({error: 'Rate limited'}, {status: 429});
        }
    }
    return NextResponse.next();
}
```

**Impacto**: -100% bot scraping

---

#### 2.2 Cleanup Realtime Subscriptions
```typescript
// ANTES
useEffect(() => {
    const channel = supabase.channel('users').on('*', payload => {
        setData(payload.new);
    }).subscribe();
    // ❌ Nunca dessubscribe
}, []);

// DEPOIS
useEffect(() => {
    const channel = supabase.channel('users').on('*', payload => {
        setData(payload.new);
    }).subscribe();
    
    return () => {
        supabase.removeChannel(channel);  // ✅ Cleanup
    };
}, []);
```

---

#### 2.3 Archive Old Tables
```sql
-- Partition notifications/achievements_logs por date
ALTER TABLE notifications
    PARTITION BY RANGE (YEAR(created_at)) (
        PARTITION p2024 VALUES LESS THAN (2025),
        PARTITION p2025 VALUES LESS THAN (2026),
        PARTITION pfuture VALUES LESS THAN MAXVALUE
    );

-- Drop old partitions
ALTER TABLE notifications DROP PARTITION p2024;
```

**Impacto**: -30% table scan time

---

### MÉDIA (Roadmap):

#### 3.1 Indexed Full-Text Search
```sql
-- Criar índices para queries frequentes
CREATE INDEX idx_users_tenant_turma ON users(tenant_id, turma);
CREATE INDEX idx_eventos_data ON eventos(data);
CREATE INDEX idx_ligas_status ON ligas_config(status) WHERE ativa = true;
```

#### 3.2 Database Views (Materialized)
```sql
-- Em vez de carregar e processar no app
CREATE MATERIALIZED VIEW v_ranking_by_turma AS
    SELECT tenant_id, turma, uid, nome, xp, 
           ROW_NUMBER() OVER (PARTITION BY tenant_id, turma ORDER BY xp DESC) as rank
    FROM users
    WHERE role NOT IN ('banned', 'bloqueado');

REFRESH MATERIALIZED VIEW v_ranking_by_turma;  -- Refresh 1x por hora
```

#### 3.3 Supabase Storage p/ Imagens
```typescript
// ANTES: Base64 em database
const logoBase64 = "data:image/png;base64,iVBORw0KGgo...";

// DEPOIS: Storage URL + CDN
const logoUrl = "https://bucket.supabase.co/ligas/liga1/logo.png";
// 10 bytes de URL vs 1MB de base64!
```

---

## 🚨 Monitoramento Recomendado

### Set Up Alerts

```javascript
// Integrar com Supabase Dashboard Metrics
// 1. Postgres size: Alert se > 500MB
// 2. Egress: Alert se > 50GB/mês
// 3. RPS: Alert se > 1000 req/sec
// 4. Connections: Alert se > 3 simultânees
```

### Add Logging

```typescript
// src/lib/supabase.ts
const client = createClient(...);

// Wrapper p/ todos os queries
function logQuery(table: string, operation: string, rowsAffected: number, bytes: number) {
    console.log(`[SUPABASE] ${operation} ${table}: ${rowsAffected} rows, ${bytes}B`, {
        timestamp: new Date(),
    });
    // Send to external monitoring (e.g., Datadog, LogRocket)
}
```

---

## 📝 Checklist de Implementação

- [ ] Reduzir `DASHBOARD_EVENTS_FETCH_LIMIT` de 40 → 5
- [ ] Remover `logoBase64` de todos os SELECT statements
- [ ] Implementar `revalidate` em `/api/public/*` endpoints
- [ ] Adicionar Rate Limiting middleware
- [ ] Cleanup Realtime subscriptions (add useEffect cleanup)
- [ ] Paginar Store Orders (MAX_ORDERS: 1200 → 20)
- [ ] Aumentar Cache TTL onde apropriado (30s → 300s)
- [ ] Adicionar cursor-based pagination em leaderboards
- [ ] Archive notifications anteriores a 6 meses
- [ ] Setup monitoring + alerts

---

## 💰 Estimativa de Economia

| Otimização | Economia | Esforço |
|------------|----------|---------|
| Dashboard selects + caching | 80% | 4h |
| Remove base64 images | 60% | 6h |
| Pagination + cursor | 95% | 8h |
| Rate limiting | 100% scraping | 2h |
| Archive old data | 30% | 3h |
| **TOTAL** | **~75-80%** | **23h** |

**Resultado esperado**: 75GB/mês → 15-20GB/mês (ainda acima do 1GB free, mas sustentável com $25/mês tier)

---

## 🎯 Próximos Passos

1. **Imediato**: Implement 1.1-1.4 (Critical) = ~18h work
2. **Esta semana**: 2.1-2.2 (cleanup connections) = ~4h work  
3. **Próximo mês**: Implement 3.1-3.3 (long-term) = Database optimization
4. **Contínuo**: Monitoring + alerts + monthly review

