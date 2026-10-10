import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RoomGate, RoomSkeleton } from "@/components/RoomGate";

export const metadata: Metadata = {
  title: "Sala · videoshare",
};

export default function SalaPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Link href="/" className="text-center text-lg font-semibold tracking-tight">
        videoshare
      </Link>
      <Suspense fallback={<RoomSkeleton />}>
        <RoomGate />
      </Suspense>
    </main>
  );
}
