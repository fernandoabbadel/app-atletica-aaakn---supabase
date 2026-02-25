import { getSupabaseClient } from "../supabase";

export interface FunctionsInstance {
  region?: string;
}

export function getFunctions(): FunctionsInstance {
  return { region: "auto" };
}

export function httpsCallable<TReq, TRes>(
  _functions: FunctionsInstance,
  name: string
): (payload: TReq) => Promise<{ data: TRes }> {
  return async (payload: TReq) => {
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
      const error = Object.assign(new Error(rpcResponse.error.message), {
        code: `functions/${rpcResponse.error.code ?? "rpc-error"}`,
        cause: rpcResponse.error,
      });
      throw error;
    }

    return { data: rpcResponse.data as TRes };
  };
}
