# videoshare

Salas pra compartilhar a tela **sem backend próprio**. A pessoa escolhe um nome, cria uma sala e manda o link. Quem abrir o link entra na sala e assiste à tela de quem está apresentando.

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

- **Next.js com `output: "export"`**: o build é só HTML/CSS/JS e pode ser hospedado em qualquer lugar.
- **[Trystero](https://github.com/dmotz/trystero)**: os navegadores se encontram por relays públicos do Nostr (só pra trocar o "aperto de mão" do WebRTC). Depois a presença e a tela vão direto de um navegador pro outro, P2P.
- **Presença**: cada participante manda `{ name, joinedAt, sharingSince }` ao conectar e de novo quando começa ou para de compartilhar.
- **Limite de 6 por sala** (`MAX_PER_ROOM` em `src/hooks/useRoom.ts`): quem chega além do limite vê "sala cheia" e sai sozinho.
- **Compartilhar tela**: qualquer pessoa, uma por vez. Quem apresenta envia o stream do `getDisplayMedia` (com o áudio da aba ou do sistema, quando o navegador oferece) pra cada participante, inclusive pra quem entra depois. Se duas pessoas começarem ao mesmo tempo, fica quem começou primeiro.

```
src/
  app/page.tsx                  home: nome + criar sala / entrar com código
  app/sala/page.tsx             /sala?id=<código>
  components/RoomGate.tsx       valida o id e pede o nome se faltar
  components/room/RoomView.tsx  sala: barra do topo, palco, controles, participantes
  hooks/useRoom.ts              toda a lógica P2P: presença e compartilhamento (Trystero)
  lib/media.ts                  captura de tela (getDisplayMedia)
  lib/                          id de sala, nome salvo, classes de estilo
```

## Limitações (por não ter servidor)

- **Relays de terceiros**: a descoberta depende dos relays públicos do Nostr. O Trystero usa vários ao mesmo tempo, mas eles não são nossos.
- **Redes restritas**: em NAT simétrico ou rede corporativa o WebRTC direto pode falhar. A solução é configurar um servidor TURN (`turnConfig` no `joinRoom`).
- **Upload de quem apresenta**: a tela é enviada separadamente pra cada pessoa (até 5). Com upload fraco a qualidade cai.
- **Celular**: dá pra assistir, mas não compartilhar. Os navegadores de celular não oferecem `getDisplayMedia`.
- **Áudio da tela**: só vai quando o navegador mostra a opção de áudio no seletor.
  - **Aba:** manda só o som da aba.
  - **Tela inteira (Windows):** manda o som do sistema todo.
  - **Janela, como um jogo:** o site pede só o som daquele programa (`windowAudio: "window"`, Chrome 141+). Se o navegador não oferecer essa opção, a janela vai sem som.
- **"Sala cheia" é best-effort**: sem autoridade central, a ordem de chegada usa o relógio de cada aparelho. Entradas simultâneas podem passar do limite por alguns segundos.
- **Código da sala = acesso**: quem tiver o link entra. Não há senha (o Trystero aceita `password` no `joinRoom` se precisar).
