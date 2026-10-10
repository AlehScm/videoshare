export const cardClass = "w-full rounded-3xl border border-line bg-panel p-6 sm:p-8";

export const inputClass =
  "w-full rounded-xl border border-line bg-stage/60 px-4 py-3 text-base text-fg outline-none transition placeholder:text-muted focus:border-signal focus:ring-4 focus:ring-signal/20";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-40";

export const primaryButtonClass = `${buttonBase} bg-signal text-stage hover:bg-[#a6b5ff] focus-visible:ring-signal/35`;

export const secondaryButtonClass = `${buttonBase} border border-line font-medium text-fg hover:bg-raised focus-visible:ring-signal/25`;

export const dangerButtonClass = `${buttonBase} bg-tally text-white hover:bg-[#ff7262] focus-visible:ring-tally/35`;
