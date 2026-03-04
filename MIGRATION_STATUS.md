# MIGRATION_STATUS

Data: 2026-03-04
Status: CONCLUIDO para runtime `src` (Supabase-only)

## Estado atual

- Banco/Auth/Storage: Supabase
- Wrapper Firestore legado: removido do `src/lib/supa/firestore.ts`
- Chamadas de leitura/escrita no `src`: Supabase (`from/select/insert/update/delete/rpc`)

## Checklist de fechamento

- [x] Remover dependencias de Firebase do runtime
- [x] Remover imports `@/lib/supa/firestore` do `src`
- [x] Remover wildcard selects no `src`
- [x] Aplicar limites em listas e paginação nos services principais
- [x] Migrar scanner admin para schema do PostgreSQL
- [x] Ajustar script de master para Supabase Admin (`setMaster.js`)
- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm run build`

## Commits chave (ultima janela)

- `fc67184` chore(detox): remove final firebase remnants and align docs/scripts
- `a5b6f4a` perf(supabase): replace wildcard selects and migrate scanner to schema-aware lookup

## Observacoes

- Documentos historicos (`PROJETO_COMPLETO_AAAKN.txt` e rascunhos antigos) podem conter exemplos de Firestore, mas nao impactam runtime.
- Se ainda aparecer erro antigo no navegador (ex.: `where is not defined`), limpar cache local (`.next`) e reiniciar `npm run dev`.

## Proximos passos (qualidade operacional)

1. Eliminar warnings de imagem (LCP/preload) nas telas iniciais.
2. Revisar schema/policies da tabela `users` em ambiente de homologacao/producao para evitar drift de colunas.
3. Consolidar testes de smoke por rota critica apos deploy.

