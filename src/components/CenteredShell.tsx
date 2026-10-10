import Link from "next/link";
import type { ReactNode } from "react";

export function CenteredShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Link href="/" className="text-center font-display text-xl font-semibold tracking-tight">
        videoshare
      </Link>
      {children}
    </main>
  );
}
