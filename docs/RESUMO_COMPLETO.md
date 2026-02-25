# 📱 AAAKN APP - RESUMO COMPLETO DE FUNCIONALIDADES

## 🎯 Visão Geral do Projeto
**App Oficial da Atlética Tubarão (AAAKN)**
- **Stack**: Next.js 15.5 + React 19 + TypeScript + Tailwind CSS
- **UI Icons**: Lucide React + React Icons
- **Gráficos**: Recharts
- **PDF Export**: html2canvas
- **Status**: Em desenvolvimento ativo

---

## 🏗️ ARQUITETURA

### Estrutura de Pastas
```
app/
├── layout.tsx, page.tsx, loading.tsx, not-found.tsx, template.tsx
├── admin/                    # Painel administrativo
│   ├── layout.tsx           # Sidebar admin
│   ├── page.tsx             # Dashboard
│   ├── conquistas/          # Gerenciar conquistas
│   ├── denuncias/           # Gerenciar denúncias
│   ├── eventos/             # Gerenciar eventos
│   ├── fidelidade/          # Programa fidelidade
│   ├── games/               # Arena games
│   ├── guia/                # Guia do bixo
│   ├── gym/                 # Gym rats
│   ├── historico/           # Histórico
│   ├── logs/                # Logs do sistema
│   ├── loja/                # Gerenciar loja
│   ├── parceiros/           # Clube de parceiros
│   ├── permissoes/          # Controle de permissões (AREA SENSÍVEL)
│   ├── planos/              # Planos
│   ├── treinos/             # Treinos
│   └── usuarios/[id]/       # Detalhes de usuários
│
├── cadastro/                # Cadastro de novos usuários
├── carrinho/                # Carrinho de compras
├── carteirinha/             # Carteirinha Digital
├── checkout/                # Checkout do carrinho
├── comunidade/              # Feed de comunidade
├── configuracoes/           # Configurações da conta
│   ├── seguranca/
│   ├── suporte/
│   └── termos/
├── conquistas/              # Conquistas do usuário
├── em-breve/                # Página de conteúdo em breve
├── empresa/                 # Info da empresa (Atlética)
│   └── cadastro/            # Cadastro de empresa (para admins)
├── eventos/[id]/            # Detalhes do evento
├── fidelidade/              # Programa de fidelidade
├── games/                   # Arena Games
├── guia/                    # Guia do Bixo (onboarding)
├── gym/                     # Gym Rats (check-in e feed)
│   ├── checkin/
│   │   ├── page.tsx
│   │   └── details/
│   └── [feed]
├── historico/               # Nossa história (sobre a atlética)
├── lib/                     # Utilitários
│   └── logger.ts            # Sistema de logs
├── login/                   # Página de login
├── loja/                    # Lojinha oficial
├── menu/                    # Menu principal do app
├── parceiros/[id]/          # Clube de parceiros
├── perfil/[id]/             # Perfil de usuários
├── planos/                  # Planos de adesão
│   └── adesao/              # Adesão ao plano
├── ranking/[turmaId]/       # Ranking por turma
├── treinos/[id]/            # Grade de treinos
│
├── components/
│   ├── BottomNav.tsx        # Navegação inferior + Sidebar
│   ├── RouteGuard.tsx       # Proteção de rotas
│   └── SharkAvatar.tsx      # Avatar com tema tubarão
│
└── context/
    ├── AuthContext.tsx      # Sistema de autenticação
    └── ToastContext.tsx     # Sistema de notificações
```

---

## 👤 SISTEMA DE AUTENTICAÇÃO E ROLES

### User Interface
```typescript
interface User {
  // Dados Básicos
  nome: string
  handle: string
  matricula: string
  turma: string
  curso: string
  
  // Gamificação
  level: number
  xp: number
  patente?: string      // Ex: "Megalodon"
  plano?: string        // Ex: "Tubarão Rei"
  
  // Redes Sociais
  foto: string
  instagram: string
  bio: string
  seguidores: number
  seguindo: number
  
  // Admin
  role: UserRole        // Ver abaixo
}
```

### Níveis de Acesso (Roles)
| Role | Acesso | Descrição |
|------|--------|-----------|
| **guest** | Público | Visitante sem login |
| **user** | Limitado | Sócio padrão |
| **admin_treino** | Moderado | Coach/Treinador |
| **admin_geral** | Alto | Diretoria |
| **admin_gestor** | Alto | Presidência |
| **master** | Total | Super admin (você) |

---

## 📱 PÁGINAS PÚBLICAS (USER)

### 🏠 Navegação Principal
| Página | Rota | Função |
|--------|------|--------|
| **Home/Menu** | `/menu` | Dashboard principal do usuário |
| **Login** | `/login` | Autenticação |
| **Cadastro** | `/cadastro` | Criar nova conta |
| **Em Breve** | `/em-breve` | Placeholder para features futuras |

### 🎮 Entretenimento
| Página | Rota | Função |
|--------|------|--------|
| **Gym Rats** | `/gym` | Check-in, feed de academia |
| **Arena Games** | `/games` | Jogos gamificados |
| **Ranking** | `/ranking/[turmaId]` | Ranking por turma |
| **Comunidade** | `/comunidade` | Feed social |

### 📚 Informações
| Página | Rota | Função |
|--------|------|--------|
| **Guia do Bixo** | `/guia` | Onboarding/FAQ |
| **Nossa História** | `/historico` | Sobre a atlética |
| **Eventos** | `/eventos` + `/eventos/[id]` | Calendário e detalhes |
| **Perfil** | `/perfil/[id]` | Perfil de usuários |

### 💰 E-commerce & Planos
| Página | Rota | Função |
|--------|------|--------|
| **Lojinha** | `/loja` | Comprar itens |
| **Carrinho** | `/carrinho` | Carrinho de compras |
| **Checkout** | `/checkout` | Finalizar compra |
| **Planos** | `/planos` | Adesão a planos |
| **Adesão** | `/planos/adesao` | Processo de adesão |

### 🎁 Programas & Rewards
| Página | Rota | Função |
|--------|------|--------|
| **Fidelidade** | `/fidelidade` | Programa de pontos |
| **Conquistas** | `/conquistas` | Badges e achievements |
| **Carteirinha** | `/carteirinha` | Cartão digital |
| **Parceiros** | `/parceiros` + `/parceiros/[id]` | Clube de parceiros |
| **Treinos** | `/treinos` + `/treinos/[id]` | Grade de treinos |

### ⚙️ Conta & Segurança
| Página | Rota | Função |
|--------|------|--------|
| **Configurações** | `/configuracoes` | Menu de config |
| **Segurança** | `/configuracoes/seguranca` | 2FA, senhas |
| **Suporte** | `/configuracoes/suporte` | FAQ/Help |
| **Termos** | `/configuracoes/termos` | T&C |
| **Perfil** | `/perfil/[id]` | Ver/editar perfil |
| **Empresa** | `/empresa` | Info empresa |

---

## 🔐 PAINEL ADMINISTRATIVO (/admin)

### Dashboard & Monitoramento
| Página | Rota | Função |
|--------|------|--------|
| **Dashboard** | `/admin` | Overview geral |
| **Logs** | `/admin/logs` | Auditoria do sistema |

### Gerenciamento de Conteúdo
| Página | Rota | Função |
|--------|------|--------|
| **Eventos** | `/admin/eventos` | CRUD de eventos |
| **Treinos** | `/admin/treinos` | CRUD de treinos |
| **Loja** | `/admin/loja` | Gerenciar produtos |
| **Guia do App** | `/admin/guia` | Editar guia |
| **Histórico** | `/admin/historico` | Gerenciar histórico |

### Gamificação & Rewards
| Página | Rota | Função |
|--------|------|--------|
| **Conquistas** | `/admin/conquistas` | CRUD de badges |
| **Fidelidade** | `/admin/fidelidade` | Programa de pontos |
| **Games** | `/admin/games` | Arena games |
| **Planos** | `/admin/planos` | Planos de adesão |

### Usuários & Comunidade
| Página | Rota | Função |
|--------|------|--------|
| **Usuários** | `/admin/usuarios` | Lista de users |
| **Detalhes User** | `/admin/usuarios/[id]` | Ver/editar user |
| **Parceiros** | `/admin/parceiros` | Parceiros premium |
| **Denúncias** | `/admin/denuncias` | Gerenciar reports |
| **Gym** | `/admin/gym` | Feed de academia |

### Área Sensível 🔒
| Página | Rota | Função | Acesso |
|--------|------|--------|--------|
| **Permissões** | `/admin/permissoes` | Gerenciar roles | Master only |

---

## 🎨 COMPONENTES PRINCIPAIS

### Navigation
- **BottomNav.tsx** (684 linhas)
  - Bottom navigation bar com 5 itens
  - Sidebar drawer lateral
  - Tier badges (bicho, atleta, lenda)
  - Growth banner (upsell de planos)
  - Hide on scroll + idle timer
  - Responsivo mobile-first

### Protection
- **RouteGuard.tsx**
  - Proteção de rotas por role
  - Redirecionamento de usuários não autorizados

### UI/UX
- **SharkAvatar.tsx**
  - Avatar customizado com tema tubarão
  - Suporta diferentes patentes/tiers

---

## 🔑 FUNCIONALIDADES PRINCIPAIS

### 1. 🎮 Gamificação
- ✅ Sistema de Tiers (Bicho, Atleta, Lenda)
- ✅ Level & XP
- ✅ Patentes (Megalodon, Barracuda, etc)
- ✅ Badges/Conquistas
- ✅ Ranking por turma
- ✅ Programa de fidelidade (pontos)

### 2. 🏋️ Gym Rats
- ✅ Check-in na academia
- ✅ Feed de atividades
- ✅ Histórico de treinos
- ✅ Detalhes de check-ins

### 3. 🎯 Eventos
- ✅ Calendário de eventos
- ✅ Detalhes do evento
- ✅ Inscrição em eventos
- ✅ Admin: CRUD de eventos

### 4. 🛍️ E-commerce
- ✅ Lojinha com produtos
- ✅ Carrinho de compras
- ✅ Checkout
- ✅ Histórico de compras

### 5. 💳 Planos & Carteirinha
- ✅ 3 planos diferentes
- ✅ Sistema de adesão
- ✅ Carteirinha digital
- ✅ Exportar carteira (PDF)

### 6. 🤝 Comunidade
- ✅ Feed social
- ✅ Perfis de usuários
- ✅ Seguir/Seguindo
- ✅ Clube de parceiros

### 7. 📊 Admin Dashboard
- ✅ Overview com métricas
- ✅ CRUD completo de recursos
- ✅ Sistema de logs/auditoria
- ✅ Gerenciamento de permissões
- ✅ Relatórios

---

## 🛠️ TECNOLOGIAS & LIBRARIES

### Frontend
```json
{
  "next": "15.5.7",           // React framework
  "react": "19.0.0",          // UI library
  "typescript": "^5",         // Type safety
  "tailwindcss": "^3.4.1",    // Styling
  "lucide-react": "^0.562.0", // Icons
  "react-icons": "^5.5.0"     // More icons
}
```

### Funcionalidades
- **Recharts**: Gráficos e visualizações
- **html2canvas**: Exportar para PDF
- **localStorage**: Persistência de dados

### Dev Tools
- **ESLint**: Code quality
- **PostCSS**: CSS processing
- **Turbopack**: Build optimization

---

## 🔒 Sistema de Autenticação

### Contexto: AuthContext.tsx
```typescript
// Funções disponíveis
- login(userData)          // Login de usuário
- logout()                 // Logout
- setUser(user)            // Atualizar usuário
- updateUser(data)         // Atualizar parcialmente
- checkPermission(roles)   // Verificar permissões

// Estado global
const { user, setUser, logout, checkPermission } = useAuth()
```

### Contexto: ToastContext.tsx
- Sistema de notificações toast
- Alertas e confirmações

---

## 📋 FEATURES EM DESENVOLVIMENTO / ROADMAP

### ✅ Implementado
- Autenticação básica
- Navegação mobile-first
- Sistema de tiers
- Gamificação básica
- E-commerce (carrinho, checkout)
- Admin dashboard
- Comunidade/Feed
- Eventos
- Treinos

### 🚧 Em Progresso
- Sistema de pagamentos real
- Notificações push
- Chat em tempo real
- Live streaming de eventos

### 📅 Planejado
- App nativo (React Native)
- Integração com sistemas externos
- Analytics avançado
- Machine Learning para recomendações

---

## 📊 ESTRUTURA DE DADOS

### Usuário (User)
```typescript
{
  nome: string
  handle: string
  matricula: string
  turma: string
  level: number
  xp: number
  foto: string
  instagram: string
  bio: string
  curso: string
  seguidores: number
  seguindo: number
  role: UserRole
  plano?: string
  patente?: string
  plano_badge?: string
}
```

### Tier System
```typescript
type Tier = 'bicho' | 'atleta' | 'lenda' | 'standard'

// Visual Config
{
  label: 'SÓCIO LENDA'
  bg: 'bg-yellow-500/10'
  text: 'text-yellow-500'
  border: 'border-yellow-500/30'
}
```

---

## 🎯 PRÓXIMOS PASSOS SUGERIDOS

1. **Backend API**: Integrar com Firebase/API REST
2. **Persistência**: Implementar banco de dados real
3. **Autenticação Real**: OAuth com Google/Instagram
4. **Pagamentos**: Stripe/MercadoPago
5. **Notificações**: Sistema push
6. **Analytics**: Tracking de eventos
7. **Tests**: Unit & E2E tests
8. **Deploy**: Vercel/Railway

---

## 📞 CONTATO & SUPORTE

**App**: AAAKN v2.5 Stable
**Data**: Janeiro 2026
**Stack**: Next.js 15 + React 19 + TypeScript
**Deploy**: Pronto para Vercel

---

> **Desenvolvido para**: Atlética Tubarão 🦈
> **Status**: Produção
> **Última atualização**: 12/01/2026
