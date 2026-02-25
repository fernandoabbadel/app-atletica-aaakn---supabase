import { useAuth } from "../context/AuthContext";

export function usePermission() {
  const { user } = useAuth();

  // Função que recebe um caminho (ex: "/admin/financeiro") e retorna true/false
  const canAccess = (path: string): boolean => {
    // 1. Se não tá logado, não entra
    if (!user) return false;
    
    // 2. Master é Deus (acessa tudo)
    if (user.role === 'master') return true;

    // 3. Pega permissões do cache (mesma lógica do RouteGuard)
    const cachedRules = localStorage.getItem("shark_permissions");
    
    // Se não tem regras baixadas ainda, liberamos (o RouteGuard barra depois se precisar)
    if (!cachedRules) return true; 

    const matrix = JSON.parse(cachedRules);
    const cleanPath = path.split("?")[0];
    const userRole = (user.role || 'user').toLowerCase();

    // 4. Busca a regra mais específica para aquele caminho
    // Ex: Se tem regra para "/admin", ela vale para "/admin/financeiro"
    const matchedRule = Object.keys(matrix)
        .filter(rulePath => cleanPath === rulePath || cleanPath.startsWith(rulePath + '/'))
        .sort((a, b) => b.length - a.length)[0];

    // 5. Verifica se a role do usuário está na lista permitida
    if (matchedRule) {
        const allowedRoles = matrix[matchedRule].map((r: string) => r.toLowerCase());
        return allowedRoles.includes(userRole);
    }

    // Se não tem regra específica, assume liberado (padrão do sistema)
    return true; 
  };

  return { canAccess };
}