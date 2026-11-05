import Image from "next/image";
import type { Photo } from "@/content/types";

/*
 * The coaching pages' header graphics (owner, 2026-10-27, picked from six
 * motion options): the page's photo with a slow zoom and one quiet layer of
 * movement on top, in white over the photo. Motion lives in globals.css and
 * only runs without Reduce Motion; otherwise the finished frame shows.
 * Shaped like PageHeader's photo (4:3 on phones, 4:5 from 1024 px).
 */

const frame = "relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-ink lg:aspect-[4/5]";
const sizes = "(min-width: 1248px) 480px, (min-width: 1024px) 38vw, 100vw";

/** 1:1 coaching (option A): corner brackets close in on Alex, "Just you and Alex". */
export function FocusFrame({ photo, tag = "Just you and Alex" }: { photo: Photo; tag?: string }) {
  return (
    <div className={frame}>
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        priority
        sizes={sizes}
        className="focus-photo object-cover"
        style={{ objectPosition: photo.position }}
      />
      <div aria-hidden="true" className="absolute top-[6%] bottom-[22%] left-[24%] w-[34%] lg:top-[9%] lg:bottom-[15%] lg:left-[24%] lg:w-[40%]">
        <div className="focus-corners absolute inset-0">
          <span className="absolute top-0 left-0 size-6 border-t-2 border-l-2 border-white" />
          <span className="absolute top-0 right-0 size-6 border-t-2 border-r-2 border-white" />
          <span className="absolute bottom-0 left-0 size-6 border-b-2 border-l-2 border-white" />
          <span className="absolute right-0 bottom-0 size-6 border-r-2 border-b-2 border-white" />
        </div>
      </div>
      <p aria-hidden="true" className="focus-tag eyebrow absolute bottom-5 left-5 text-white">
        {tag}
      </p>
    </div>
  );
}
