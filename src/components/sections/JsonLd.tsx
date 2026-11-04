import { site } from "@/content/site";
import { siteUrl } from "@/lib/env";

/**
 * LocalBusiness structured data. Contains verified facts only: no opening
 * hours, prices or ratings until confirmed.
 */
export function JsonLd() {
  const l = site.location;
  const data = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: site.name,
    description: site.description,
    url: siteUrl(),
    logo: `${siteUrl()}/icon.png`,
    sameAs: [site.social.raeng.url, site.social.instagram.url, site.social.facebook.url],
    address: {
      "@type": "PostalAddress",
      streetAddress: l.street,
      addressLocality: l.town,
      addressRegion: l.region,
      postalCode: l.postcode,
      addressCountry: l.countryCode,
    },
  };

  return (
    <script
      type="application/ld+json"
      // Escape "<" per Next.js JSON-LD guidance to prevent script injection.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
