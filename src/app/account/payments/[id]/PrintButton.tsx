"use client";

/** Opens the browser's print dialog (which can also save the receipt as a PDF). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="members-btn w-full sm:w-auto print:hidden">
      Print or save as PDF
    </button>
  );
}
