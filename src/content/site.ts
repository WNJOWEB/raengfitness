import type { Logo, Photo } from "./types";

/**
 * Single source of truth for brand, location and contact details.
 * Only add values here once they are verified (see CORE.md).
 */
export const site = {
  name: "Alex K Bells",
  descriptor: "Kettlebell Coach",
  description:
    "Kettlebell coaching in Cumbernauld: group classes, one-to-one coaching and online coaching with Alex K Bells.",

  /**
   * The supplied logo (source: assets/brand/alexkbells-logo-source.jpg),
   * cropped by scripts/brand_assets.py into transparent white artwork.
   * These PNGs are for dark surfaces only. Set to null to fall back to the
   * plain-text brand name.
   */
  logo: {
    /** AR monogram with kettlebell — header. */
    mark: { src: "/brand/logo-mark.png", width: 741, height: 368, alt: "" },
    /** Full lockup: monogram, ALEX.KBELLS, KETTLEBELL COACH — footer. */
    lockup: {
      src: "/brand/logo-lockup.png",
      width: 978,
      height: 554,
      alt: "Alex K Bells, Kettlebell Coach",
    },
    /** Name as written on the logo artwork; shown beside the mark in the header. */
    wordmark: "ALEX.KBELLS",
  } as { mark: Logo; lockup: Logo; wordmark: string } | null,

  location: {
    venue: "Media House",
    street: "1A Dunns Wood Road",
    town: "Cumbernauld",
    city: "Glasgow",
    postcode: "G67 3EN",
    region: "Scotland",
    country: "United Kingdom",
    countryCode: "GB",
  },

  contact: {
    /** Not yet supplied. Leave null until verified; null values are not rendered. */
    email: null as string | null,
    phone: null as string | null,
  },

  social: {
    instagram: {
      handle: "@alex.kbells",
      url: "https://www.instagram.com/alex.kbells/",
      /** From his profile on 2026-10-15 (9,651). Update occasionally; never round up. */
      followers: "9.6k",
    },
    /**
     * Alex's Facebook page "Alex.kbells", supplied by the project owner
     * 2026-10-18 (share link → page id 61589486540520; the page links back to
     * @alex.kbells). The stable page URL, without the share link's tracking.
     */
    facebook: {
      name: "Alex.kbells",
      url: "https://www.facebook.com/profile.php?id=61589486540520",
    },
  },

  /**
   * Homepage hero loop cut from Alex's own Instagram reel by
   * scripts/hero_video.py (his caption/handle overlays removed, black and
   * white, silent, 4:5). Takes priority over photos.hero. Null to disable.
   */
  heroVideo: {
    // Browsers use the first format they can play. H.264 MP4 comes first:
    // Safari/iOS loop it reliably (their WebM looping can stall on a black
    // frame). Exact codecs let browsers without H.264 skip to the WebM.
    sources: [
      { src: "/media/hero.mp4", type: 'video/mp4; codecs="avc1.64001F"' },
      { src: "/media/hero.webm", type: 'video/webm; codecs="vp9"' },
    ],
    poster: "/media/hero-poster.jpg",
  } as { sources: { src: string; type: string }[]; poster: string } | null,

  /**
   * Stills taken from the same reel as the hero video (genuine training
   * footage; same permission caveat, see CORE.md). Frames showing other gyms'
   * branding were left out.
   */
  trainingStills: [
    { src: "/images/training/group.jpg", width: 720, height: 900, alt: "A coached group doing kettlebell goblet squats" },
    { src: "/images/training/swing.jpg", width: 720, height: 900, alt: "Two people training kettlebell swings in a gym" },
    { src: "/images/training/rack.jpg", width: 720, height: 900, alt: "A group holding kettlebells in the front rack position" },
  ] as Photo[],

  /**
   * Inner page header images (desktop only), cut from the hero loop by
   * scripts/video_stills.py. Same footage and permission caveat as above.
   * The classes header reuses the group still; no other group frame in the
   * loop is sharp and free of other gyms' branding.
   */
  pageImages: {
    classes: { src: "/images/training/rack.jpg", width: 720, height: 900, alt: "A group holding kettlebells in the front rack position" },
    coaching: { src: "/images/training/double-swing.jpg", width: 720, height: 900, alt: "A double kettlebell swing in a gym" },
    contact: { src: "/images/training/bell-hold.jpg", width: 720, height: 900, alt: "Holding a kettlebell at chest height in a gym" },
  } as Record<"classes" | "coaching" | "contact", Photo | null>,

  /**
   * Genuine photos of Alex / his coaching only. Empty until supplied. The
   * personal portrait that was used in the About section was removed on
   * 2026-11-05 at Alex's request (the About section is now about the brand).
   */
  photos: {
    hero: null as Photo | null,
  },
} as const;

/**
 * Top navigation answers the four questions Alex wants every visitor to get
 * answered: what he offers, why kettlebells, who he is, and where/how to book.
 * Each jumps to that section of the homepage.
 */
export const mainNav = [
  { label: "Why kettlebells", href: "/#why-kettlebells" },
  { label: "Ways to train", href: "/#ways-to-train" },
  { label: "About RAENG", href: "/#about" },
  { label: "How to book", href: "/#how-to-book" },
] as const;

/** Extra pages listed in the phone menu and footer, after mainNav. */
export const pageNav = [
  { label: "Group classes", href: "/classes" },
  { label: "1:1 & small group", href: "/coaching" },
  { label: "Online coaching", href: "/online-coaching" },
  { label: "Contact", href: "/contact" },
] as const;

/** Alex's sign-in: last in the phone menu and the footer, like his previous site. */
export const coachLoginNav = { label: "Coach login", href: "/coach/login" } as const;

/**
 * Footer links: the pages, plus "How to book". The footer logo already links
 * home and the header menu has the homepage sections, so they aren't repeated.
 */
export const footerNav = [
  ...pageNav.filter((item) => item.href !== "/contact"),
  mainNav[3], // How to book
  ...pageNav.filter((item) => item.href === "/contact"),
  coachLoginNav,
] as const;

export function formatAddressLines(): string[] {
  const l = site.location;
  return [l.venue, l.street, `${l.town}, ${l.city}`, l.postcode];
}

export function mapsUrl(): string {
  const l = site.location;
  const query = [l.venue, l.street, l.town, l.postcode].join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
