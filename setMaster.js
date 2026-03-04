const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_UID = process.env.TARGET_UID || "BvOxvOOHefZQi9pLaNlauXGrZTS2";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Deu ruim no plantao! Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY antes de rodar setMaster.js."
  );
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function setMaster() {
  const uid = String(TARGET_UID).trim();
  if (!uid) {
    console.error("UID alvo invalido.");
    process.exit(1);
  }

  console.log(`Atualizando role master para uid=${uid}...`);

  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(uid);
  if (authError || !authUser?.user) {
    console.error("Falha ao localizar usuario no Auth:", authError || "usuario nao encontrado");
    process.exit(1);
  }

  const currentMetadata =
    authUser.user.user_metadata && typeof authUser.user.user_metadata === "object"
      ? authUser.user.user_metadata
      : {};
  const nextMetadata = { ...currentMetadata, role: "master" };

  const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(uid, {
    user_metadata: nextMetadata,
  });
  if (updateAuthError) {
    console.error("Falha ao atualizar metadata no Auth:", updateAuthError);
    process.exit(1);
  }

  const nowIso = new Date().toISOString();
  const { error: updateUserError } = await supabaseAdmin
    .from("users")
    .update({ role: "master", updatedAt: nowIso })
    .eq("uid", uid);
  if (updateUserError) {
    console.error("Falha ao atualizar role na tabela public.users:", updateUserError);
    process.exit(1);
  }

  console.log("Aí sim! O Tubarão aprovou! role=master aplicado com sucesso.");
}

setMaster().catch((error) => {
  console.error("Deu ruim no plantao! Erro inesperado ao aplicar role master:", error);
  process.exit(1);
});
