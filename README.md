# videoshare

Salas de presença em tempo real **sem backend próprio**. A pessoa escolhe um nome, cria uma sala e manda o link. Quem abrir o link aparece na lista de todos na hora, e some quando fecha a aba.

**No ar:** https://alehscm.github.io/videoshare/

## Rodando

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # gera site 100% estático em out/
```

Para testar sozinho: abra o link da sala em duas abas (ou uma normal e uma anônima). Em cada aba dá pra usar um nome diferente.

## Deploy

Todo push na `master` publica no GitHub Pages pelo workflow `.github/workflows/deploy.yml`. Ele roda o build com `NEXT_PUBLIC_BASE_PATH=/videoshare`, porque o Pages serve o site nesse subcaminho. Localmente a variável fica vazia e o site roda na raiz.

## Como funciona

- **Next.js com `output: "export"`**: o build é só HTML/CSS/JS e pode ser hospedado em qualquer lugar (Vercel, Netlify, Cloudflare Pages, GitHub Pages, nginx…).
- **[Trystero](https://github.com/dmotz/trystero)**: os navegadores se encontram por relays públicos do Nostr (só pra trocar o "aperto de mão" do WebRTC) e depois conversam direto, P2P. Nenhum dado da sala passa por servidor nosso.
- Cada participante manda `{ name, joinedAt }` aos outros quando a conexão abre. A lista é ordenada por ordem de chegada.
- **Limite de 6 por sala** (`MAX_PER_ROOM` em `src/hooks/useRoomPresence.ts`): quem chega além do limite vê "sala cheia" e sai sozinho, e os outros nem chegam a exibi-lo.

```
src/
  app/page.tsx              home: nome + criar sala / entrar com código
  app/sala/page.tsx         /sala?id=<código>
  components/RoomGate.tsx   valida o id e pede o nome se faltar
  components/RoomView.tsx   lista de presentes, copiar link, sair
  hooks/useRoomPresence.ts  toda a lógica P2P (Trystero)
  lib/                      id de sala, nome salvo, classes de estilo
```

## Limitações (por não ter servidor)

- **Relays de terceiros**: a descoberta depende dos relays públicos do Nostr. O Trystero usa vários ao mesmo tempo, mas eles não são nossos.
- **Redes restritas**: em NAT simétrico ou rede corporativa o WebRTC direto pode falhar. A solução é configurar um servidor TURN (`turnConfig` no `joinRoom`).
- **"Sala cheia" é best-effort**: sem autoridade central, a ordem de chegada usa o relógio de cada aparelho. Relógios muito fora de hora ou entradas simultâneas podem passar do limite por alguns segundos.
- **Código da sala = acesso**: quem tiver o link entra. Não há senha (o Trystero aceita `password` no `joinRoom` se precisar).

## Próximos passos possíveis

Vídeo/áudio (`room.addStream`), chat, deploy na Vercel, servidor TURN.
