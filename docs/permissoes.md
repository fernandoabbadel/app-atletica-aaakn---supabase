# 🛡️ DOCUMENTAÇÃO DE SEGURANÇA & PERMISSÕES (RBAC) - AAAKN

> **Protocolo de Segurança:** Role Based Access Control (Controle de Acesso Baseado em Cargos).
> **Objetivo:** Garantir que cada usuário só veja o que é necessário para sua função.

---

## 1. A Hierarquia do Oceano (Cargos)

Definimos 5 níveis de acesso no sistema. A segurança é feita em cascata:

### 👑 1. MASTER (Presidente/Dono)
* **Poder:** Acesso Total (God Mode).
* **Exclusividade:** * Acessar `/admin/permissoes` (Promover/Rebaixar usuários).
    * Visualizar Logs de Auditoria sensíveis.
    * Deletar registros críticos.

### 🛡️ 2. ADMIN (Diretoria Geral)
* **Poder:** Operacional Completo do Painel.
* **Acesso:** Eventos, Loja, Histórico, Guia, Denúncias, Planos, Usuários (Leitura).
* **Bloqueio:** Não pode alterar cargos de outros Admins nem acessar configurações críticas do sistema (Permissões).

### 💪 3. TREINADOR (Diretor de Esportes/Técnico)
* **Poder:** Foco Esportivo.
* **Acesso:** * `/admin/treinos`: Realizar chamada e gerenciar agenda.
    * `/admin/gym`: Visualizar Ranking.
* **Bloqueio:** Financeiro, Loja, Denúncias, Configurações Gerais.

### 💼 4. EMPRESA (Parceiros)
* **Poder:** Validação de Benefícios.
* **Acesso:** Exclusivo à rota `/empresa` (Dashboard do Parceiro).
* **Bloqueio:** Total ao `/admin`.

### 🐟 5. USUARIO (Sócio/Aluno)
* **Poder:** Uso do App.
* **Acesso:** Rotas públicas e de membros (`/menu`, `/loja`, `/carteirinha`, `/perfil`).
* **Bloqueio:** Barrado em qualquer rota `/admin/*`.

---

## 2. Matriz de Bloqueio (Route Guard)

Tabela de referência para implementação do `RouteGuard.tsx`:

| Rota | MASTER | ADMIN | TREINADOR | EMPRESA | USUARIO | VISITANTE |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `/admin` (Dash Geral) | ✅ | ✅ | ⚠️ (Limitado) | ❌ | ❌ | ❌ |
| `/admin/permissoes` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `/admin/financeiro` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/admin/treinos` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/admin/denuncias` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `/empresa/*` | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| `/carteirinha` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (Login) |

---

## 3. Lógica da Página `/admin/permissoes`

Esta página é a "Sala de Comando".

1.  **Listagem Inteligente:** Lista todos os usuários cadastrados no Firebase.
2.  **Filtros:** Abas rápidas para filtrar: "Staff" (Master/Admin/Treinador), "Empresas" e "Membros".
3.  **Link Direto:** Clicar no usuário redireciona para `/admin/usuarios/[id]` (Detalhes).
4.  **Switch de Poder (Apenas MASTER):**
    * O dropdown de alteração de cargo (`select`) só é renderizado se `currentUser.role === 'master'`.
    * Para outros admins, o campo aparece como texto estático (apenas leitura).
5.  **Auditoria:** Toda alteração de cargo dispara um log: *"Master [Nome] alterou cargo de [Usuario] para [NovoCargo]"*.

---

## 4. Lógica do Treinador (Fluxo de Presença)

Otimizado para ser rápido durante o treino:

1.  **Entrada:** Treinador acessa `/admin/treinos`.
2.  **Visualização:** Vê apenas os treinos do dia/semana (Card View).
3.  **Ação:** Clica no treino -> Abre lista de inscritos.
4.  **Chamada:** Lista de nomes com um "Toggle" (Switch) ao lado.
    * 🟢 Ativo = Presente
    * ⚪ Inativo = Ausente
5.  **Cálculo:** Ao salvar/finalizar treino, o sistema calcula XP automaticamente e atualiza o Ranking.

---

## 5. Casos Especiais

### Visitante
* Não possui registro no banco de dados.
* Pode acessar: Home (`/`), Login, Cadastro, vitrine da Loja (sem comprar).
* Se tentar acessar qualquer rota protegida, é redirecionado para `/login`.

### Empresa
* Não é um "Admin" da Atlética, é um parceiro externo.
* Ao logar, se o cargo for `empresa`, o redirecionamento automático vai para `/empresa` (não vai para `/menu` nem `/admin`).
* Funcionalidade principal: Validar QR Code da carteirinha.