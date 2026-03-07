import { useAuth } from "../context/AuthContext";
import {
  getAccessRoleCandidates,
  isPlatformMaster,
  resolveEffectiveAccessRole,
} from "@/lib/roles";
import { parseTenantScopedPath } from "@/lib/tenantRouting";

export function usePermission() {
  const { user } = useAuth();

  // Função que recebe um caminho (ex: "/admin/financeiro") e retorna true/false
  const canAccess = (path: string): boolean => {
    // 1. Se não tá logado, não entra
    if (!user) return false;
    
    // 2. Master é Deus (acessa tudo)
    if (isPlatformMaster(user)) return true;

    // 3. Pega permissões do cache (mesma lógica do RouteGuard)
    const cachedRules = localStorage.getItem("shark_permissions");
    
    // Se não tem regras baixadas ainda, liberamos (o RouteGuard barra depois se precisar)
    if (!cachedRules) return true; 

    const matrix = JSON.parse(cachedRules);
    const cleanPath = parseTenantScopedPath(path.split("?")[0]).scopedPath;
    const userRole = resolveEffectiveAccessRole(user);
    const roleCandidates = getAccessRoleCandidates(user);

    // 4. Busca a regra mais específica para aquele caminho
    // Ex: Se tem regra para "/admin", ela vale para "/admin/financeiro"
    const matchedRule = Object.keys(matrix)
        .filter(rulePath => cleanPath === rulePath || cleanPath.startsWith(rulePath + '/'))
        .sort((a, b) => b.length - a.length)[0];

    // 5. Verifica se a role do usuário está na lista permitida
    if (matchedRule) {
        const allowedRoles = matrix[matchedRule].map((r: string) => r.toLowerCase());
        return (
          allowedRoles.includes(userRole) ||
          roleCandidates.some((role) => allowedRoles.includes(role))
        );
    }

    // Se não tem regra específica, assume liberado (padrão do sistema)
    return true; 
  };

  return { canAccess };
}
