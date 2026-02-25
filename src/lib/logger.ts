import { db } from "./firebase"; 
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { isFirebasePermissionError } from "./firebaseErrors";

export type ActionType = 
  | "CREATE" 
  | "UPDATE" 
  | "DELETE" 
  | "LOGIN" 
  | "ERROR" 
  | "LIKE"       
  | "QUIZ"       
  | "FOLLOW"     
  | "UNFOLLOW"
  | "GAME_CYCLE";

// 🦈 Correção: 'any' substituído por 'unknown' (Tipagem segura)
export const logActivity = async (
  userId: string,
  userName: string, 
  action: ActionType,
  resource: string, 
  details: unknown 
) => {
  try {
    // Verifica se é objeto para stringificar, senão converte direto pra string
    const detailsString = typeof details === 'object' && details !== null 
        ? JSON.stringify(details) 
        : String(details);

    await addDoc(collection(db, "activity_logs"), {
      userId,
      userName: userName || "Anônimo",
      action,
      resource,
      details: detailsString,
      timestamp: serverTimestamp(),
    });
    
    if (process.env.NODE_ENV === 'development') {
        console.log(`🦈 [LOG]: ${userName} realizou ${action} em ${resource}`);
    }
  } catch (error: unknown) {
    if (!isFirebasePermissionError(error)) {
      console.error("Erro ao salvar log:", error);
    }
  }
};
