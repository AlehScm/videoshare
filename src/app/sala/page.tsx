import type { Metadata } from "next";
import { Suspense } from "react";
import { RoomGate, RoomSkeleton } from "@/components/RoomGate";

export const metadata: Metadata = {
  title: "Sala · videoshare",
};

export default function SalaPage() {
  return (
    <Suspense fallback={<RoomSkeleton />}>
      <RoomGate />
    </Suspense>
  );
}
