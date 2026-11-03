/** Public, indexable routes. Keep in sync with src/app when pages are added. */
export const publicRoutes = [
  "/",
  "/classes",
  "/memberships",
  "/memberships/join",
  "/coaching",
  "/contact",
  "/about",
  "/privacy",
  "/terms",
  "/book",
  "/book/group-class",
  "/book/one-to-one",
] as const;

/** Member sign-in (2026-10-26): linked from the menu and footer, never in the sitemap or indexed. */
export const memberRoutes = ["/account/sign-in"] as const;

/** Coach sign-in: linked from the footer, but never in the sitemap or indexed. */
export const coachRoutes = ["/coach/login"] as const;
