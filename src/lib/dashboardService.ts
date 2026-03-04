import {
  clearDashboardCaches as clearDashboardCachesNative,
  fetchDashboardBundle as fetchDashboardBundleNative,
  toggleDashboardEventLike as toggleDashboardEventLikeNative,
  toggleDashboardPostLike as toggleDashboardPostLikeNative,
  toggleDashboardProductLike as toggleDashboardProductLikeNative,
  type DashboardBundle,
  type DashboardEvent,
  type DashboardLiga,
  type DashboardPartner,
  type DashboardPost,
  type DashboardProduct,
  type DashboardTurmaStat,
} from "./dashboardPublicService";

export type {
  DashboardTurmaStat,
  DashboardEvent,
  DashboardProduct,
  DashboardLiga,
  DashboardPartner,
  DashboardPost,
  DashboardBundle,
};

export async function fetchDashboardBundle(options?: {
  forceRefresh?: boolean;
}): Promise<DashboardBundle> {
  return fetchDashboardBundleNative(options);
}

export async function toggleDashboardEventLike(payload: {
  eventId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  await toggleDashboardEventLikeNative(payload);
}

export async function toggleDashboardProductLike(payload: {
  productId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  await toggleDashboardProductLikeNative(payload);
}

export async function toggleDashboardPostLike(payload: {
  postId: string;
  userId: string;
  currentlyLiked: boolean;
}): Promise<void> {
  await toggleDashboardPostLikeNative(payload);
}

export function clearDashboardCaches(): void {
  clearDashboardCachesNative();
}
