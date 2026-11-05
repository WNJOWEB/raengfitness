import Image from "next/image";
import Link from "next/link";
import { site } from "@/content/site";
import { cn } from "@/lib/cn";

interface LogoProps {
  /**
   * mark: AR monogram + brand name text (header).
   * lockup: the full supplied logo (footer).
   */
  variant?: "mark" | "lockup";
  /** Surface behind the logo. The artwork is white, so light surfaces get an ink tile. */
  tone?: "dark" | "light";
  className?: string;
  priority?: boolean;
}

function BrandText({ tone, name, className }: { tone: "dark" | "light"; name: string; className?: string }) {
  const muted = tone === "dark" ? "text-muted-inverse" : "text-muted";
  return (
    <span className={cn("flex-col items-center leading-none", className)}>
      {/* Negative right margin cancels the trailing letter-spacing so the text centres. */}
      <span className="mr-[-0.1em] whitespace-nowrap text-base font-extrabold uppercase tracking-[0.1em] [font-stretch:112%] sm:mr-[-0.14em] sm:text-lg sm:tracking-[0.14em]">
        {name}
      </span>
      {/* As on the logo artwork: the descriptor between two short rules. */}
      <span className={cn("mt-1.5 flex w-full items-center gap-1.5", muted)}>
        <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-current" />
        <span className="mr-[-0.24em] whitespace-nowrap text-[0.5625rem] font-medium uppercase tracking-[0.24em] sm:text-[0.625rem]">
          {site.descriptor}
        </span>
        <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-current" />
      </span>
    </span>
  );
}

/**
 * Uses the supplied logo artwork from site.ts. Without it, falls back to the
 * plain brand name in the body typeface — never an imitation of the monogram.
 */
export function Logo({ variant = "mark", tone = "dark", className, priority = false }: LogoProps) {
  const logo = site.logo;
  const tile = tone === "light" && "bg-ink p-2";

  return (
    <Link
      href="/"
      className={cn("inline-flex min-h-11 items-center gap-3", className)}
      aria-label={`${site.name}, home`}
    >
      {!logo ? (
        <BrandText tone={tone} name={site.name} className="flex" />
      ) : variant === "lockup" ? (
        <Image
          src={logo.lockup.src}
          alt=""
          width={logo.lockup.width}
          height={logo.lockup.height}
          sizes="240px"
          className={cn("h-auto w-48 sm:w-56", tile)}
        />
      ) : (
        <>
          <Image
            src={logo.mark.src}
            alt=""
            width={logo.mark.width}
            height={logo.mark.height}
            priority={priority}
            sizes="96px"
            className={cn("h-9 w-auto sm:h-10", tile)}
          />
          {/* Name beside the mark from 360px up; the narrowest phones show the mark alone. */}
          <BrandText tone={tone} name={logo.wordmark} className="hidden sm:flex" />
        </>
      )}
    </Link>
  );
}
