/** Public, indexable routes. Keep in sync with src/app when pages are added. */
export const publicRoutes = [
  "/",
  "/classes",
  "/coaching",
  "/contact",
  "/online-coaching",
  "/privacy",
  "/book",
  "/book/group-class",
  "/book/one-to-one",
  "/book/small-group",
] as const;

/** Coach sign-in: linked from the footer, but never in the sitemap or indexed. */
export const coachRoutes = ["/coach/login"] as const;
