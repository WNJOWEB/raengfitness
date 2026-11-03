import { Icon } from "./icons";

/**
 * What a members page shows the instant a tab is tapped, while the real page
 * is fetched (owner, 2026-11-02, after the speed audit): the same header and
 * tab bar, and the shape of the page as quiet blocks. It holds no data and no
 * links, so it can be sent ahead to the phone. Screen readers hear "Loading".
 */
export function MembersLoading() {
  return (
    <div data-members-app data-skeleton className="members-app min-h-dvh bg-paper text-ink" aria-busy="true">
      <header className="sticky top-0 z-20 border-b border-line bg-paper">
        <div className="mx-auto grid h-[60px] max-w-[620px] grid-cols-[44px_1fr_44px] items-center px-5">
          <span aria-hidden="true" className="flex flex-col gap-[5px]">
            <i className="block h-[2px] w-[22px] bg-ink" />
            <i className="block h-[2px] w-[14px] bg-ink" />
          </span>
          <span className="justify-self-center pl-[0.34em] text-center text-[1.0625rem] leading-tight font-extrabold tracking-[0.34em]">
            RAENG
            <span className="-mt-0.5 block text-[0.5625rem] font-semibold tracking-[0.4em] text-ink">MEMBERS</span>
          </span>
          <span aria-hidden="true" className="size-9 justify-self-end rounded-full bg-ink" />
        </div>
      </header>

      <div className="mx-auto max-w-[620px] px-5 pt-7 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        <div role="status" className="members-view flex flex-col gap-7">
          <h1 className="sr-only">Loading your page…</h1>
          <div aria-hidden="true" className="flex flex-col gap-3">
            <div className="sk-bar w-24" />
            <div className="sk-bar !h-9 w-4/5" />
          </div>
          <div aria-hidden="true" className="sk h-44" />
          <div aria-hidden="true" className="flex items-center gap-4">
            <div className="sk size-24 !rounded-full" />
            <div className="flex flex-1 flex-col gap-3">
              <div className="sk-bar w-2/3" />
              <div className="sk-bar w-1/2" />
            </div>
          </div>
          <div aria-hidden="true" className="flex flex-col gap-3">
            <div className="sk h-16" />
            <div className="sk h-16" />
          </div>
        </div>
      </div>

      <nav aria-hidden="true" className="members-tabs fixed inset-x-0 bottom-0 z-20 border-t border-line pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-[620px] grid-cols-3">
          {(["home", "book", "plan"] as const).map((v) => (
            <li key={v} className="members-tab">
              <Icon name={v} />
              {v === "home" ? "Home" : v === "book" ? "Book" : "Plan"}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
