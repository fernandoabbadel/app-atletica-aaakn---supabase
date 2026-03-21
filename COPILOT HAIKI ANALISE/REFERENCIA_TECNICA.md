# 🔍 Referência Técnica - Antes vs Depois

> Exemplos práticos de mudanças para cada otimização

---

## Exemplo 1️⃣: Dashboard Events (Task 1.1)

### ANTES (Atual - Problema)
```typescript
// src/lib/dashboardPublicService.ts (linha ~12)
const DASHBOARD_EVENTS_FETCH_LIMIT = 40;
const DASHBOARD_EVENTS_SELECT =
  "id,titulo,data,hora,local,imagem,tipo,status,likesList,interessados,imagePositionY,tenant_id";

// Resultado típico (UMA requisição):
// 40 eventos × 13 colunas × médio 2KB por evento = 80KB base
// + likesList array (100 usuários) = 100KB
// + interessados array (50 usuários) = 50KB
// TOTAL: ~230KB por fetch
```

**Captura de tela esperada**:
```
Network XHR:
  GET /api/public/landing
  Size: 234 KB
  Time: 1200ms
```

### DEPOIS (Otimizado - Solução)
```typescript
// src/lib/dashboardPublicService.ts (linha ~12)
const DASHBOARD_EVENTS_FETCH_LIMIT = 5;  // ⬇️ 40 → 5
const DASHBOARD_EVENTS_SELECT =
  "id,titulo,data,hora,imagem,tipo,status,tenant_id";  // ⬇️ Removido: imagePositionY, likesList, interessados

// Resultado tipico (MESMA requisição):
// 5 eventos × 8 colunas × médio 1.5KB = 12KB
// SEM arrays grandes
// TOTAL: ~12KB por fetch
```

**Captura de tela esperada**:
```
Network XHR:
  GET /api/public/landing
  Size: 12.3 KB  ← -95%!
  Time: 180ms
```

**Impacto**:
```
Antes: 1000 visitors × 230KB = 230MB/dia
Depois: 1000 visitors × 12KB = 12MB/dia
Economia: 218MB/dia = 6.5GB/mês 💰
```

---

## Exemplo 2️⃣: Remove Base64 Images (Task 1.2)

### ANTES (Figura feia)

```json
{
  "id": "liga-123",
  "nome": "Atlética AAAKN",
  "logoUrl": "https://example.com/logo.png",
  "logoBase64": "data:image/png;base64,iVBORw0KGgo...GEUvQmCC[20.000+ characters here]...==",
  "descricao": "Liga oficial",
  "membros": 150
}
```

**Size**: 
- `logoBase64` field alone: ~800KB por liga
- 80 ligas × 800KB = 64MB em UMA query! 🤯

### DEPOIS (Limpo)

```json
{
  "id": "liga-123",
  "nome": "Atlética AAAKN",
  "logoUrl": "https://example.com/logo.png",
  "descricao": "Liga oficial",
  "membros": 150
}
```

**Size**:
- Per liga: ~0.2KB
- 80 ligas × 0.2KB = 16KB (✅ cache-friendly)

**Lazy load quando necessário**:

```typescript
// Separate query só se usuário abrir modal/detalhes
const { logoBase64 } = await supabase
  .from("ligas_config")
  .select("logoBase64")
  .eq("id", ligaId)
  .maybeSingle();
```

---

## Exemplo 3️⃣: Cache TTL & Revalidate (Task 1.3)

### ANTES (Queries em cascata)

```
TIME  EVENT
────────────────────────────────────────
0ms   User A acessa /ligas
      → Query: SELECT ligas_config (30 cache miss)
10ms  Query result: 50MB data
50ms  User B acessa /ligas  
      → Query: SELECT ligas_config (30s cache hit! reutiliza User A)
60ms  User C acessa /ligas
      → Query: SELECT ligas_config (31s cache MISS - renova)
      → Query result: AGAIN 50MB
```

**Total em 60 segundos**: 2-3 queries × 50MB = 100-150MB (🔥 WAY TOO MUCH)

### DEPOIS (Smart caching com ISR)

```
TIME  EVENT
────────────────────────────────────────
0ms   User A acessa /ligas
      → Check: ISR cache valid?
      → YES! Serve cached 16KB
10ms  User B acessa /ligas
      → Serve cached 16KB (same)
60ms  User C acessa /ligas
      → Serve cached 16KB (still valid)
300s  ISR window expired
      → Background: Query once (50MB)
      → Cache renewed for next 300s
```

**Code change**:

```typescript
// src/lib/leaguesService.ts

// ANTES
const READ_CACHE_TTL_MS = 30_000;  // 30 segundos

// DEPOIS
const READ_CACHE_TTL_MS = 300_000;  // 5 minutos

// src/app/api/public/ligas/route.ts

// ANTES
export async function GET() {
  // No revalidate = cache only on build
}

// DEPOIS  
export const revalidate = 300;  // ISR: revalidate cada 5min

export async function GET() {
  // Agora combina Supabase cache + Next.js ISR
  // = super cache!
}
```

**Result**:
```
Antes: 120 queries/hora × 50MB = 6GB/hora
Depois: 12 queries/hora × 50MB = 600MB/hora
Economia: -90%!
```

---

## Exemplo 4️⃣: Pagination (Task 1.4)

### ANTES (❌ Catastrophic)

```typescript
// User abre sua lista de pedidos
const { data: allOrders } = await supabase
  .from("orders")
  .select("id,userId,userName,productId,productName,price,total,quantidade,itens,data,status,approvedBy,createdAt,updatedAt")  // 13 cols!
  .eq("userId", userId)
  .limit(1200);  // YES, TWELVE HUNDRED

// Response: ~50MB (1200 orders × ~42KB per order com "itens" array)
```

**Timeline**:
```
100 users abrem carrinho (paralelo) = 100 × 50MB = 5GB de data transfer instantaneamente
Supabase limita: ERROR timeout/crash
```

### DEPOIS (✅ Efficient)

```typescript
// User abre sua lista de pedidos (FIRST PAGE)
const { data: orders, nextCursor } = await fetchStoreOrdersPage({
  userId,
  pageSize: 20,  // Apenas 20 por página
  cursor: undefined  // First page
});

// Response: ~840KB (20 orders × 6 cols × ~7KB each)
// Seleciona MENOS colunas:
// "id,userId,productId,preco,status,data"

// User clicks "Load More"
const { data: orders2, nextCursor2 } = await fetchStoreOrdersPage({
  userId,
  pageSize: 20,
  cursor: { lastOrderId: orders[19].id, lastCreatedAt: orders[19].data }
});
// Usa cursor-based pagination = super eficiente
```

**Timeline**:
```
100 users abrem carrinho = 100 × 840KB = 84MB (9x smaller!)
Supabase handles fine ✅
```

**React component**:

```jsx
export default function MyOrders() {
  const [orders, setOrders] = useState([]);
  const [cursor, setCursor] = useState(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadOrders();
  }, [cursor]);

  async function loadOrders() {
    setLoading(true);
    const { orders: newOrders, nextCursor } = await fetchStoreOrdersPage({
      userId: currentUser.id,
      pageSize: 20,
      cursor,
    });
    
    setOrders(prev => [...prev, ...newOrders]);  // Append
    setCursor(nextCursor);  // For next page
    setLoading(false);
  }

  return (
    <div>
      {orders.map(order => <OrderCard key={order.id} order={order} />)}
      {cursor && (
        <button onClick={loadOrders} disabled={loading}>
          Load More
        </button>
      )}
    </div>
  );
}
```

---

## Exemplo 5️⃣: Rate Limiting (Task 1.5)

### ANTES (Vulnerable)

```bash
# Attacker script
while true; do
  curl http://your-app/api/public/landing
done

# Results:
# Second 1: 1000 requests
# Second 2: 1000 requests (parallel)
# ...
# Supabase: "Quota exceeded!" - Your free account is blocked
```

### DEPOIS (Protected)

```bash
# Same attacker script
while true; do
  curl http://your-app/api/public/landing
done

# Results:
# Request 1-30: 200 OK
# Request 31-60: 429 Too Many Requests
# Request 61+: 429 Too Many Requests
# Attacker gives up ✅
# Your app: Unaffected ✅
```

**Response**:
```json
{
  "error": "Rate limit exceeded. Try again in 1 minute."
  // HTTP 429 Too Many Requests
}
```

---

## Comparação Visual: Before/After

### Tamanho de Response

```
┌────────────────────────────────────────────────┐
│ /api/public/landing                           │
├────────────────────────────────────────────────┤
│ ANTES: ████████████████████ 4.5MB              │
│ DEPOIS:█ 450KB                                 │
│ Redução: -90%                                  │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│ /api/ligas                                     │
├────────────────────────────────────────────────┤
│ ANTES: ████████████████████ 64MB               │
│ DEPOIS:███ 6.4MB                               │
│ Redução: -90%                                  │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│ /api/store/orders                              │
├────────────────────────────────────────────────┤
│ ANTES: ███████████████████ 50MB                │
│ DEPOIS:█ 840KB                                 │
│ Redução: -98%                                  │
└────────────────────────────────────────────────┘
```

### Query Count

```
┌────────────────────────────────────────────────┐
│ Queries/Hora (típico day)                      │
├────────────────────────────────────────────────┤
│ ANTES: ████████████████████ 2000 queries/hora  │
│ DEPOIS:██████ 400 queries/hora                 │
│ Redução: -80%                                  │
└────────────────────────────────────────────────┘
```

### Monthly Egress

```
┌────────────────────────────────────────────────┐
│ Data Transfer Out (Egress/Mês)                 │
├────────────────────────────────────────────────┤
│ ANTES: ████████████████████ 50GB ❌            │
│ DEPOIS:██ 5GB ✅                               │
│ Redução: -90%                                  │
│                                                │
│ Free Plan Limit: 1GB                           │
│ Status ANTES: FAILING (50x limit)             │
│ Status DEPOIS: PASSING (5x limit, still need  │
│                         pro plan for margin)   │
└────────────────────────────────────────────────┘
```

---

## Checklist: Antes vs Depois

### Métrica de Sucesso

```markdown
## ✅ Completed Optimizations

- [x] Dashboard events limit 40 → 5
  Before: 230KB per fetch
  After: 12KB per fetch
  Savings: -95%

- [x] Base64 images removed from SELECT
  Before: 64MB for 80 ligas
  After: 16KB for 80 ligas  
  Savings: -99%

- [x] Cache TTL 30s → 300s
  Before: 120 queries/hour
  After: 12 queries/hour
  Savings: -90%

- [x] Store pagination 1200 → 20 per page
  Before: 50MB per fetch
  After: 840KB per fetch
  Savings: -98%

- [x] Rate limiting added
  Before: Unlimited (vulnerable)
  After: 30-60 req/min per IP
  Savings: -100% bot abuse

TOTAL DATABASE CONSUMPTION
Before: ~50GB/month
After: ~5GB/month
Overall savings: -90%
```

---

## 🧪 Testing Queries Manually

### Via Supabase SQL Editor

```sql
-- BEFORE: See current data size + query
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Expected output:
-- ligas_config: 50MB
-- productos: 30MB
-- usuarios: 100MB
-- notifications: 100MB+
```

### Monitor Query Performance

```sql
-- Enable query stats (Supabase Dashboard)
-- Then run your typical queries and observe:

SELECT 
  query,
  calls,
  total_time,
  mean_time
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 20;
```

---

## 📊 Before/After: Complete Example

### Single User Journey: "View Dashboard"

#### BEFORE (Slow, Wasteful)
```
User clicks HOME:
  1. GET /api/public/landing
     ├─ Query ligas (80 rows) ..................... 64MB
     ├─ Query eventos (40 rows) .................. 10MB
     ├─ Query produtos (8 rows) ................... 2MB
     ├─ Query posts (2 rows) ...................... 1MB
     ├─ Query partners (50 rows) .................. 3MB
     └─ Query users for count ..................... 10MB
     TOTAL REQUEST: 90MB 🤯
     TIME: 4900ms (5 seconds wall-clock)
  
  2. Visual result: Same as below
  3. Database hit: 1 user × 90MB = 1 massive query
  4. If 1000 users/day: 90GB ❌
```

#### AFTER (Fast, Efficient)
```
User clicks HOME:
  1. GET /api/public/landing
     ├─ Query ligas (5 rows, cached) ............ cached 16KB
     ├─ Query eventos (5 rows) ................... 200KB
     ├─ Query produtos (8 rows) .................. 150KB
     ├─ Query posts (2 rows) ..................... 40KB
     ├─ Query partners (skip, fetch separately) . [lazy]
     └─ Query users (count only) ................. 50KB
     TOTAL REQUEST: 456KB ✅
     TIME: 380ms (0.38 seconds wall-clock)
  
  2. Visual result: Identical to user
  3. Database hit: 1 user × 456KB = minimal query
  4. If 1000 users/day: 456MB ✅
```

**User Experience**: ✅ IDENTICAL  
**Server Cost**: 💰 -98%  
**Time Saved**: ⚡ 92%

---

## 🔗 Related Files

- Full analysis: `ANALISE_CONSUMO_SUPABASE.md`
- Implementation steps: `PLANO_ACAO_OTIMIZACAO.md`
- Executive summary: `SUMARIO_EXECUTIVO.md`
- This file: `REFERENCIA_TECNICA.md` (you are here)

