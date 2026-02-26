import { getSupabaseClient } from "../supabase";

export interface FunctionsInstance {
  region?: string;
}

export function getFunctions(): FunctionsInstance {
  return { region: "auto" };
}

function shouldUseRemoteCallable(): boolean {
  if (typeof window === "undefined") return true;
  if (process.env.NEXT_PUBLIC_FORCE_CALLABLES === "true") return true;

  const host = window.location.hostname.toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
}

export function httpsCallable<TReq, TRes>(
  _functions: FunctionsInstance,
  name: string
): (payload: TReq) => Promise<{ data: TRes }> {
  return async (payload: TReq) => {
    if (!shouldUseRemoteCallable()) {
      throw Object.assign(new Error(`Callable remoto desabilitado em dev local: ${name}`), {
        code: "functions/not-found",
      });
    }

    const supabase = getSupabaseClient();

    // Prioridade para Edge Functions (mesma ideia de callable remota).
    const edgeResponse = await supabase.functions.invoke(name, {
      body: payload as unknown as
        | string
        | Blob
        | File
        | ArrayBuffer
        | FormData
        | ReadableStream<Uint8Array>
        | Record<string, unknown>
        | undefined,
    });

    if (!edgeResponse.error) {
      return { data: (edgeResponse.data as TRes) };
    }

    // Fallback para RPC Postgres quando a funcao estiver exposta via rpc.
    const rpcResponse = await supabase.rpc(name, payload as Record<string, unknown>);
    if (rpcResponse.error) {
      const rpcCode =
        typeof rpcResponse.error.code === "string" ? rpcResponse.error.code.toUpperCase() : "";
      const rpcMessage =
        typeof rpcResponse.error.message === "string"
          ? rpcResponse.error.message.toLowerCase()
          : "";

      // Permite que as camadas de servico reconhecam "funcao inexistente" e usem fallback local.
      const isMissingRpc =
        rpcCode === "PGRST202" ||
        rpcCode === "42883" ||
        rpcMessage.includes("could not find the function") ||
        (rpcMessage.includes("function") && rpcMessage.includes("does not exist"));

      const error = Object.assign(new Error(rpcResponse.error.message), {
        code: isMissingRpc ? "functions/not-found" : `functions/${rpcResponse.error.code ?? "rpc-error"}`,
        cause: rpcResponse.error,
      });
      throw error;
    }

    return { data: rpcResponse.data as TRes };
  };
}
