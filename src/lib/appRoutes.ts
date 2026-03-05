// src/lib/appRoutes.ts

// 1. ZONA SEGURA (PÃºblicas - Login, Erro, Em Breve)
// O RouteGuard ignora a verificaÃ§Ã£o para estas rotas para evitar loops.
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

// 2. ZONA DE DEGUSTAÃ‡ÃƒO (O que visitante logado como GUEST vÃª)
// Visitantes podem ver o Dashboard, Perfil BÃ¡sico e Lojas, mas com restriÃ§Ãµes de aÃ§Ã£o
export const GUEST_ALLOWED_PATHS = [
  ...PUBLIC_PATHS, // Inclui todas as pÃºblicas automaticamente
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

// 4. MAPA DO SISTEMA (Lista completa para o Painel Admin - Gerenciador de PermissÃµes)
export const APP_PAGES = [
    // --- ADMINISTRAÃ‡ÃƒO ---
    { path: '/admin', label: 'ðŸ‘® Admin Dashboard' },
    { path: '/admin/album', label: 'ðŸ“· Adm Ãlbum' },
    { path: '/admin/carteirinha', label: 'ðŸªª Adm Carteirinha' },
    { path: '/admin/comunidade', label: 'ðŸ’¬ Adm Comunidade' },
    { path: '/admin/configuracoes', label: 'âš™ï¸ ConfiguraÃ§Ãµes (Adm)' },
    { path: '/admin/conquistas', label: 'ðŸ… Adm Conquistas' },
    { path: '/admin/denuncias', label: 'ðŸš¨ DenÃºncias' },
    { path: '/admin/eventos', label: 'ðŸ“… Adm Eventos' },
    { path: '/admin/eventos/encerrados', label: '🗃️ Adm Eventos Encerrados' },
    { path: '/admin/fidelidade', label: 'ðŸ’Ž Adm Fidelidade' },
    { path: '/admin/games', label: 'ðŸŽ® Adm Games' },
    { path: '/admin/guia', label: 'ðŸ“˜ Adm Guia' },
    { path: '/admin/gym', label: 'ðŸ‹ï¸ Adm Gym' },
    { path: '/admin/historico', label: 'ðŸ“œ Adm HistÃ³rico' },
    { path: '/admin/landing', label: 'ðŸ‘¥ Gerenciar LandingPage' },
    { path: '/admin/ligas', label: 'ðŸ† Adm Ligas' },
    { path: '/admin/logs', label: 'ðŸ“ Logs do Sistema' },
    { path: '/admin/loja', label: 'ðŸ‘• Adm Loja' },
    { path: '/admin/parceiros', label: 'ðŸ¤ Adm Parceiros' },
    { path: '/admin/permissoes', label: 'ðŸ”‘ PermissÃµes (CrÃ­tico)' },
    { path: '/admin/planos', label: 'ðŸ“ Adm Planos' },
    { path: '/admin/scanner', label: 'ðŸ“· Scanner QR' },
    { path: '/admin/sharkround', label: 'ðŸ¦ˆ Adm SharkRound' },
    { path: '/admin/treinos', label: 'ðŸ’ª Adm Treinos' },
    { path: '/admin/treinos/antigos', label: 'ðŸ—ƒï¸ Adm Treinos Antigos' },
    { path: '/admin/usuarios', label: 'ðŸ‘¥ Gerenciar UsuÃ¡rios' },

    // --- PÃšBLICO / MEMBROS ---
    { path: '/album', label: 'ðŸ“¸ Ãlbum' },
    { path: '/carteirinha', label: 'ðŸªª Carteirinha' },
    { path: '/comunidade', label: 'ðŸ’¬ Comunidade' },
    { path: '/configuracoes', label: 'âš™ï¸ Ajustes (User)' },
    { path: '/conquistas', label: 'ðŸ… Conquistas' },
    { path: '/dashboard', label: 'ðŸ  Dashboard' },
    { path: '/empresa', label: 'ðŸ’¼ Painel Empresa' },
    { path: '/eventos', label: 'ðŸŽ‰ Eventos' },
    { path: '/fidelidade', label: 'ðŸ’Ž Fidelidade' },
    { path: '/games', label: 'ðŸŽ® Games' },
    { path: '/guia', label: 'ðŸ“˜ Guia' },
    { path: '/gym', label: 'ðŸ‹ï¸ Gym / Check-in' },
    { path: '/historico', label: 'ðŸ“œ HistÃ³rico' },
    { path: '/ligas', label: 'ðŸ† Ligas (Geral)' },
    { path: '/ligas_unitau', label: 'ðŸŸï¸ Ligas Unitau' },
    { path: '/loja', label: 'ðŸ›ï¸ Loja' },
    { path: '/parceiros', label: 'ðŸ¤ Parceiros' },
    { path: '/perfil', label: 'ðŸ‘¤ Perfil' },
    { path: '/planos', label: 'ðŸ“ Planos' },
    { path: '/ranking', label: 'ðŸ“Š Ranking' },
    { path: '/sharkround', label: 'ðŸ¦ˆ SharkRound' },
    { path: '/treinos', label: 'ðŸ’ª Treinos' },
].sort((a, b) => a.path.localeCompare(b.path));

