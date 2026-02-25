const admin = require("firebase-admin");

// 1. Carrega a chave que você baixou e renomeou para service-account.json
// SE DER ERRO AQUI, É PORQUE O ARQUIVO NÃO ESTÁ NA RAIZ OU ESTÁ COM OUTRO NOME
const serviceAccount = require("./service-account.json"); 

// 2. Inicia o Firebase com poder total
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// 🦈 SEU UID (Já peguei do código que você mandou)
const SEU_UID = "BvOxvOOHefZQi9pLaNlauXGrZTS2"; 

async function setMaster() {
  console.log(`🦈 Iniciando protocolo Master para o Tubarão: ${SEU_UID}...`);

  try {
    // A MÁGICA: Isso grava 'role: master' no seu token de autenticação
    // CUSTO DE LEITURA FUTURA: ZERO
    await admin.auth().setCustomUserClaims(SEU_UID, { role: 'master' });
    
    // Atualiza também no banco visualmente para o painel Admin não ficar confuso
    await admin.firestore().collection("users").doc(SEU_UID).set({
      role: 'master'
    }, { merge: true });

    console.log("✅ SUCESSO! A tatuagem digital 'Master' foi aplicada.");
    console.log("👉 IMPORTANTE: Faça LOGOUT e LOGIN no app para o novo token valer.");
    
  } catch (error) {
    console.error("❌ ERRO:", error);
    console.log("DICA: Verifique se o arquivo service-account.json está na pasta certa.");
  }
}

setMaster();