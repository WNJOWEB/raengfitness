/**
 * What a coach page shows the instant a tab or link is tapped, while its data
 * loads (owner, 2026-11-02, after the speed audit): the shape of a page as
 * quiet blocks, in place of a line of grey text. Holds no data.
 */
export function CoachLoading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <p className="sr-only">Loading the page…</p>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="sk-bar w-24" />
        <div className="sk-bar !h-9 w-3/4" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sk h-24" />
        <div className="sk h-24" />
        <div className="sk h-24" />
      </div>
      <div aria-hidden="true" className="sk h-56" />
      <div aria-hidden="true" className="sk h-40" />
    </div>
  );
}
