"use client";

// "Save as PDF" via the browser's print dialog — the sheet page carries
// print: styles that strip nav/chat so the printout is just the dossier.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 print:hidden"
    >
      Print / save PDF
    </button>
  );
}
