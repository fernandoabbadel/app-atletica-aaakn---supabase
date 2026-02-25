import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";

import { db } from "./firebase";

type RawData = Record<string, unknown>;

type QueryRow<T extends RawData = RawData> = {
  id: string;
  data: T;
};

const MAX_FEED_RESULTS = 40;
const MAX_ADMIN_POST_RESULTS = 80;
const MAX_REPORT_RESULTS = 80;
const MAX_COMMENT_RESULTS = 60;

const boundedLimit = (requested: number, maxAllowed: number): number => {
  if (!Number.isFinite(requested)) return maxAllowed;
  if (requested < 1) return 1;
  if (requested > maxAllowed) return maxAllowed;
  return Math.floor(requested);
};

export async function fetchCommunityConfig(): Promise<RawData | null> {
  const snap = await getDoc(doc(db, "app_config", "comunidade"));
  if (!snap.exists()) return null;
  return snap.data() as RawData;
}

export async function fetchCommunityFeed(
  maxResults = MAX_FEED_RESULTS
): Promise<QueryRow[]> {
  const q = query(
    collection(db, "posts"),
    orderBy("createdAt", "desc"),
    limit(boundedLimit(maxResults, MAX_FEED_RESULTS))
  );
  const snap = await getDocs(q);
  return snap.docs.map((row) => ({ id: row.id, data: row.data() as RawData }));
}

export async function fetchCommunityAdminPosts(
  maxResults = MAX_ADMIN_POST_RESULTS
): Promise<QueryRow[]> {
  const q = query(
    collection(db, "posts"),
    orderBy("createdAt", "desc"),
    limit(boundedLimit(maxResults, MAX_ADMIN_POST_RESULTS))
  );
  const snap = await getDocs(q);
  return snap.docs.map((row) => ({ id: row.id, data: row.data() as RawData }));
}

export async function fetchCommunityReports(
  maxResults = MAX_REPORT_RESULTS
): Promise<QueryRow[]> {
  const q = query(
    collection(db, "denuncias"),
    orderBy("timestamp", "desc"),
    limit(boundedLimit(maxResults, MAX_REPORT_RESULTS))
  );
  const snap = await getDocs(q);
  return snap.docs.map((row) => ({ id: row.id, data: row.data() as RawData }));
}

export async function fetchCommunityComments(
  postId: string,
  options?: { maxResults?: number; order?: "asc" | "desc" }
): Promise<QueryRow[]> {
  const cleanPostId = postId.trim();
  if (!cleanPostId) return [];

  const orderDirection = options?.order ?? "asc";
  const maxResults = boundedLimit(options?.maxResults ?? MAX_COMMENT_RESULTS, MAX_COMMENT_RESULTS);

  const q = query(
    collection(db, "posts", cleanPostId, "comments"),
    orderBy("createdAt", orderDirection),
    limit(maxResults)
  );

  const snap = await getDocs(q);
  return snap.docs.map((row) => ({ id: row.id, data: row.data() as RawData }));
}
