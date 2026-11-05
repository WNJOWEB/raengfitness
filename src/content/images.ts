import type { Photo } from "./types";

/**
 * Every photograph on the site, by role. To replace a picture, drop the new
 * file into public/images/raeng/ (or overwrite the existing one) and edit
 * its entry here: no component needs to change.
 *
 * Recommended: portrait 4:5 or taller, 1100 px wide or more, JPEG at
 * roughly 80% quality. `position` sets the focal point when a frame is
 * cropped (CSS object-position). Describe what is visible in `alt`, nothing
 * more: never name people unless they have agreed to be named.
 *
 * The current files are photographs supplied by the project owner on
 * 2026-10-21 as the working set. They show real people training. Confirm
 * that everyone shown is happy to appear on the website, and replace any
 * frame that isn't (see CORE.md).
 */
const dir = "/images/raeng";

export const images = {
  /** Home hero until the owner's film is added (content/media.ts). Wide crop of a tall photo, so the focal point matters. */
  hero: {
    src: `${dir}/hero-coach-kettlebell-swing.jpg`,
    width: 1100,
    height: 1949,
    alt: "A coach demonstrates a two-handed kettlebell swing in a training studio while a group follows behind",
    position: "50% 45%",
  },
  /** The 1:1 swing photo (owner's photo, 2026-10-23); not currently shown (online coaching uses `onlineCoaching` since 2026-10-27). */
  oneToOne: {
    src: `${dir}/one-to-one-swing.jpg`,
    width: 942,
    height: 1669,
    alt: "A man in a teal T-shirt swings a kettlebell to chest height, with a second person swinging behind him",
    position: "50% 40%",
  },
  /** Group classes page hero: the still shown only if the film (content/media.ts) is switched off. */
  classes: {
    src: `${dir}/class-swing-wide.jpg`,
    width: 1200,
    height: 1770,
    alt: "A group in a dark training studio mid-way through kettlebell swings, one person in the foreground",
    position: "50% 48%",
  },
  /**
   * Alex standing by a kettlebell (owner's photo, 2026-10-27), in Meet your
   * coach on /about. Cropped to 4:5 so no third-party signage shows.
   */
  coach: {
    src: `${dir}/coach-alex-kettlebell.jpg`,
    width: 1000,
    height: 1250,
    alt: "Alex in a blue T-shirt standing barefoot on a mat in a dark training studio, a kettlebell at his feet",
    position: "40% 35%",
  },
  /** The same photo in the 1:1 coaching page's header graphic (FocusFrame): Alex upper body on phones. */
  coachHeader: {
    src: `${dir}/coach-alex-kettlebell.jpg`,
    width: 1000,
    height: 1250,
    alt: "Alex in a blue T-shirt standing barefoot on a mat in a dark training studio, a kettlebell at his feet",
    position: "40% 22%",
  },
  /**
   * Small group coaching page header (owner, 2026-11-05): Alex leading a class
   * through kettlebell swings, the group training behind him.
   */
  smallGroupHeader: {
    src: `${dir}/small-group-class-swing.jpg`,
    width: 1000,
    height: 1772,
    alt: "Alex swinging a kettlebell at the front of a class, with the group training behind him in a dark studio",
    position: "50% 38%",
  },
  /**
   * Online coaching page header (owner, 2026-10-27): a client on a video call
   * with his coach on a tablet, a RAENG Fitness banner and kettlebells behind.
   * Cut from an illustrative image the owner supplied, with all its writing
   * removed; the banner carries the real RAENG lockup (public/brand, black on
   * cream, as the owner sent it 2026-10-27) in place of the image's mock logo,
   * and the coach on the tablet is Alex, from his own photo (owner, 2026-10-27). 4:5.
   */
  onlineCoaching: {
    src: `${dir}/online-coaching-call.jpg`,
    width: 1000,
    height: 1250,
    alt: "A man on a video call with Alex on a tablet, in front of a RAENG Fitness banner and a rack of kettlebells",
    position: "50% 50%",
  },
  /** "Why kettlebells" (option C, owner 2026-10-23): one photo beside the numbered list. Cropped so no third-party signage shows. */
  whyKettlebells: {
    src: "/images/why/class-swing.jpg",
    width: 600,
    height: 800,
    alt: "A man in a teal T-shirt at the bottom of a kettlebell swing, with the class swinging behind him",
    position: "50% 15%",
  },
} satisfies Record<string, Photo>;

export type ImageRole = keyof typeof images;
