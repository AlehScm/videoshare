import { ScreenShare } from "lucide-react";
import { MAX_PER_ROOM, type Participant } from "@/hooks/useRoom";

const AVATAR_COLORS = ["bg-[#8fa2ff]", "bg-[#f2a65a]", "bg-[#4fc1b5]", "bg-[#d78bd0]", "bg-[#e8c95a]", "bg-[#7cc3f5]"];

function avatarColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

type Props = {
  participants: Participant[];
  presenterId: string | null;
};

export function ParticipantsPanel({ participants, presenterId }: Props) {
  return (
    <aside className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 lg:min-h-0">
      <h2 className="flex items-baseline justify-between">
        <span className="font-display text-lg font-semibold">Na sala</span>
        <span className="text-sm tabular-nums text-muted">
          {participants.length} de {MAX_PER_ROOM}
        </span>
      </h2>

      <ul className="-mx-2 flex flex-col gap-0.5 overflow-y-auto">
        {participants.map((participant) => {
          const presenting = participant.id === presenterId;
          return (
            <li key={participant.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full font-display font-semibold text-stage ${avatarColor(participant.id)}`}
                aria-hidden
              >
                {participant.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {participant.name}
                {participant.isSelf && <span className="ml-1.5 text-sm text-muted">(você)</span>}
              </span>
              {presenting ? (
                <span className="flex items-center gap-1 text-xs font-medium text-tally">
                  <ScreenShare className="size-4" aria-hidden />
                  <span className="sr-only lg:not-sr-only">apresentando</span>
                </span>
              ) : (
                <span className="size-2 rounded-full bg-online" aria-label="online" />
              )}
            </li>
          );
        })}
      </ul>

      {participants.length <= 1 && (
        <p className="text-sm text-muted">Ainda não chegou ninguém. O link da sala está no topo da tela.</p>
      )}
    </aside>
  );
}
