"use client";

import { Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = { stream: MediaStream; isLocal: boolean };

export function StageVideo({ stream, isLocal }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.muted = isLocal;
    video.play().catch(() => {
      if (isLocal) return;
      video.muted = true;
      if (stream.getAudioTracks().length > 0) setSoundBlocked(true);
      video.play().catch(() => {});
    });
  }, [stream, isLocal]);

  function enableSound() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    void video.play();
    setSoundBlocked(false);
  }

  return (
    <>
      <video ref={videoRef} autoPlay playsInline muted={isLocal} className="size-full object-contain" />
      {soundBlocked && (
        <button
          type="button"
          onClick={enableSound}
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-fg px-4 py-2 text-sm font-semibold text-stage shadow-lg transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/40"
        >
          <Volume2 className="size-4" aria-hidden />
          Ativar som
        </button>
      )}
    </>
  );
}
