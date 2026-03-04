# AUDIT_FIRESTORE_DEPENDENCY

Data: 2026-03-04
Projeto: app-atletica-aaakn - supabase

## Resultado executivo

- `src/lib/supa/firestore.ts`: AUSENTE
- Imports de `supa/firestore` no `src`: 0
- `select("*")` no `src`: 0
- APIs legadas do Firestore no `src` (`writeBatch`, `runTransaction`, `arrayUnion`, `onSnapshot`, etc): 0

Conclusao: a base de codigo ativa (`src`) esta em modo Supabase puro para acesso a dados.

## Evidencias (comandos)

```powershell
rg -n -F "supa/firestore" src
rg -n -F '.select("*")' src
rg -n -F ".select('*')" src
rg -n "writeBatch|runTransaction|arrayUnion|arrayRemove|serverTimestamp|onSnapshot|addDoc|setDoc|getDoc|getDocs|updateDoc|deleteDoc" src
```

Todos retornaram sem ocorrencias relevantes de runtime.

## Pontos ja resolvidos nesta fase

- Scanner admin migrou para lookup de schema via Supabase:
  - `scanSupabaseTableFields` em `src/lib/partnersService.ts`
  - `src/app/admin/scanner/page.tsx` atualizado
- Dominios e legado Firebase removidos de configuracao:
  - `next.config.ts` sem `firebasestorage.googleapis.com`
  - `setMaster.js` reescrito para Supabase Admin API
- Comentarios e nomenclatura legada limpos em arquivos de app/lib.
- Remocao de wildcard select em services principais (`storeService`, `reportsService`, `adminUsersService`, `partnersService`).

## Risco residual

Nao ha bloqueador de migracao Firestore no codigo fonte `src`.
Os unicos residuos encontrados estao em arquivos de documentacao historica fora do runtime.

## Proximas acoes recomendadas (pos-migracao)

1. Executar smoke test funcional em:
   - `/dashboard`
   - `/eventos` e `/eventos/[id]`
   - `/loja` e `/loja/[id]`
   - `/admin/scanner`
2. Limpar warnings de console nao relacionados a Firestore:
   - LCP/preload de imagens
   - warnings de lockfile root do Next/Turbopack
3. Revisar politicas e schema drift no `users` para evitar erros de coluna ausente em ambientes com cache antigo.

