"use client";

import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadVolume, saveVolume } from "@/lib/volume-storage";

type Props = { stream: MediaStream; isLocal: boolean };

function VolumeIcon({ level }: { level: number }) {
  if (level === 0) return <VolumeX className="size-5" aria-hidden />;
  if (level < 0.5) return <Volume1 className="size-5" aria-hidden />;
  return <Volume2 className="size-5" aria-hidden />;
}

export function StageVideo({ stream, isLocal }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [hasAudio, setHasAudio] = useState(() => stream.getAudioTracks().length > 0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isLocal || muted;
  }, [volume, muted, isLocal]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    video.play().catch(() => {
      if (isLocal) return;
      video.muted = true;
      setMuted(true);
      if (stream.getAudioTracks().length > 0) setSoundBlocked(true);
      video.play().catch(() => {});
    });
  }, [stream, isLocal]);

  useEffect(() => {
    const update = () => setHasAudio(stream.getAudioTracks().length > 0);
    stream.addEventListener("addtrack", update);
    stream.addEventListener("removetrack", update);
    return () => {
      stream.removeEventListener("addtrack", update);
      stream.removeEventListener("removetrack", update);
    };
  }, [stream]);

  function unmute() {
    setMuted(false);
    setSoundBlocked(false);
    void videoRef.current?.play().catch(() => {});
  }

  function changeVolume(next: number) {
    setVolume(next);
    saveVolume(next);
    if (next > 0 && muted) unmute();
  }

  const level = muted ? 0 : volume;

  return (
    <>
      <video ref={videoRef} autoPlay playsInline muted={isLocal} className="size-full object-contain" />

      {soundBlocked && (
        <button
          type="button"
          onClick={unmute}
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-fg px-4 py-2 text-sm font-semibold text-stage shadow-lg transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/40"
        >
          <Volume2 className="size-4" aria-hidden />
          Ativar som
        </button>
      )}

      {!isLocal && hasAudio && (
        <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-stage/70 py-1.5 pl-1.5 pr-4 backdrop-blur transition-colors hover:bg-stage/90 focus-within:bg-stage/90">
          <button
            type="button"
            onClick={() => (muted ? unmute() : setMuted(true))}
            aria-label={muted ? "Ativar som" : "Silenciar"}
            title={muted ? "Ativar som" : "Silenciar"}
            className="flex size-9 items-center justify-center rounded-full text-fg transition hover:bg-raised focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-signal/30"
          >
            <VolumeIcon level={level} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(level * 100)}
            onChange={(event) => changeVolume(Number(event.target.value) / 100)}
            aria-label="Volume da tela compartilhada"
            aria-valuetext={`${Math.round(level * 100)}%`}
            className="w-24 cursor-pointer accent-signal sm:w-32"
          />
        </div>
      )}
    </>
  );
}
