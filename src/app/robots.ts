import type { MetadataRoute } from "next";
import { isIndexable, siteUrl } from "@/lib/env";

/**
 * Only the production site is crawlable; previews and review builds are not.
 * The member and coach areas are excluded (the coach area without a bare "/coach" prefix, which would also block /coaching).
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/coach$", "/coach/", "/account", "/memberships/join/done", "/book/done", "/book/manage", "/pay/done"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
