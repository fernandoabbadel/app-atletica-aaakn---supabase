// src/lib/appRoutes.ts

// 1. ZONA SEGURA (Públicas - Login, Erro, Em Breve)
// O RouteGuard ignora a verificação para estas rotas para evitar loops.
export const PUBLIC_PATHS = [
  "/login",
  "/",
  "/historico",
  "/cadastro",
  "/configuracoes",
  "/configuracoes/termos",
  "/empresa/cadastro",
  "/recuperar-senha",
  "/sem-permissao",
  "/banned",
  "/em-breve",
  "/nao-encontrado"
];

// 2. ZONA DE DEGUSTAÇÃO (O que visitante logado como GUEST vê)
// Visitantes podem ver o Dashboard, Perfil Básico e Lojas, mas com restrições de ação
export const GUEST_ALLOWED_PATHS = [
  ...PUBLIC_PATHS, // Inclui todas as públicas automaticamente
  "/dashboard",
  "/empresa", // Painel da empresa
  "/perfil",
  "/loja",
  "/games",
  "/ranking",
  "/treinos"
];

// 3. ZONA DE OBRAS (Funcionalidades em desenvolvimento - redirecionam para Em Breve)
export const COMING_SOON_PATHS = [
  "/carrinho",
  "/checkout",
  // "/marketplace-futuro",
  // "/shark-tv"
];

// 4. MAPA DO SISTEMA (Lista completa para o Painel Admin - Gerenciador de Permissões)
export const APP_PAGES = [
    // --- ADMINISTRAÇÃO ---
    { path: '/admin', label: '👮 Admin Dashboard' },
    { path: '/admin/album', label: '📷 Adm Álbum' },
    { path: '/admin/carteirinha', label: '🪪 Adm Carteirinha' },
    { path: '/admin/comunidade', label: '💬 Adm Comunidade' },
    { path: '/admin/configuracoes', label: '⚙️ Configurações (Adm)' },
    { path: '/admin/conquistas', label: '🏅 Adm Conquistas' },
    { path: '/admin/denuncias', label: '🚨 Denúncias' },
    { path: '/admin/eventos', label: '📅 Adm Eventos' },
    { path: '/admin/fidelidade', label: '💎 Adm Fidelidade' },
    { path: '/admin/games', label: '🎮 Adm Games' },
    { path: '/admin/guia', label: '📘 Adm Guia' },
    { path: '/admin/gym', label: '🏋️ Adm Gym' },
    { path: '/admin/historico', label: '📜 Adm Histórico' },
    { path: '/admin/landing', label: '👥 Gerenciar LandingPage' },
    { path: '/admin/ligas', label: '🏆 Adm Ligas' },
    { path: '/admin/logs', label: '📝 Logs do Sistema' },
    { path: '/admin/loja', label: '👕 Adm Loja' },
    { path: '/admin/parceiros', label: '🤝 Adm Parceiros' },
    { path: '/admin/permissoes', label: '🔑 Permissões (Crítico)' },
    { path: '/admin/planos', label: '📝 Adm Planos' },
    { path: '/admin/scanner', label: '📷 Scanner QR' },
    { path: '/admin/sharkround', label: '🦈 Adm SharkRound' },
    { path: '/admin/treinos', label: '💪 Adm Treinos' },
    { path: '/admin/treinos/antigos', label: '🗃️ Adm Treinos Antigos' },
    { path: '/admin/usuarios', label: '👥 Gerenciar Usuários' },

    // --- PÚBLICO / MEMBROS ---
    { path: '/album', label: '📸 Álbum' },
    { path: '/carteirinha', label: '🪪 Carteirinha' },
    { path: '/comunidade', label: '💬 Comunidade' },
    { path: '/configuracoes', label: '⚙️ Ajustes (User)' },
    { path: '/conquistas', label: '🏅 Conquistas' },
    { path: '/dashboard', label: '🏠 Dashboard' },
    { path: '/empresa', label: '💼 Painel Empresa' },
    { path: '/eventos', label: '🎉 Eventos' },
    { path: '/fidelidade', label: '💎 Fidelidade' },
    { path: '/games', label: '🎮 Games' },
    { path: '/guia', label: '📘 Guia' },
    { path: '/gym', label: '🏋️ Gym / Check-in' },
    { path: '/historico', label: '📜 Histórico' },
    { path: '/ligas', label: '🏆 Ligas (Geral)' },
    { path: '/ligas_unitau', label: '🏟️ Ligas Unitau' },
    { path: '/loja', label: '🛍️ Loja' },
    { path: '/parceiros', label: '🤝 Parceiros' },
    { path: '/perfil', label: '👤 Perfil' },
    { path: '/planos', label: '📝 Planos' },
    { path: '/ranking', label: '📊 Ranking' },
    { path: '/sharkround', label: '🦈 SharkRound' },
    { path: '/treinos', label: '💪 Treinos' },
].sort((a, b) => a.path.localeCompare(b.path));

