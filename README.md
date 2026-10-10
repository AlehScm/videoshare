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
- **Compartilhar tela**: qualquer pessoa, uma por vez. Quem apresenta envia o stream do `getDisplayMedia` (com o áudio da aba ou do sistema, quando o navegador oferece) pra cada participante, inclusive pra quem entra depois. Se outra pessoa clicar em compartilhar enquanto alguém apresenta, aparece uma confirmação e a tela dela substitui a atual: vence quem começou por último.
- **Volume**: cada pessoa que assiste ajusta o volume (ou silencia) a tela compartilhada só no próprio computador, pelo controle no canto do palco. O valor fica salvo no navegador.
- **Qualidade da transmissão** (`src/lib/media.ts`, `sendScreen`/`retuneSenders` em `useRoom.ts`):
  - **Captura:** até 1080p a 30 fps.
  - **Fluidez primeiro:** com `contentHint: "motion"` e `maintain-framerate`, quando falta banda cai a resolução, não os fps.
  - **Codec:** H.264 vai na frente pra codificar na placa de vídeo e não no processador.
  - **Teto de bitrate:** divide ~24 Mbps de upload entre quem assiste, de 3 a 8 Mbps por pessoa (5 pessoas assistindo dá 4,8 Mbps cada). O controle de congestionamento do WebRTC continua baixando se a rede não aguentar.
- **Ícone de qualidade** (`src/hooks/useStreamStats.ts`, `QualityIndicator.tsx`): no canto do palco. Lê o `getStats()` a cada segundo e mostra:
  - **Pra quem assiste:** resolução, fps, taxa recebida, perda, ping, travadas e codec.
  - **Pra quem apresenta:** o envio pra cada pessoa.
  - **O problema em português:** internet de envio no limite, computador sobrecarregado, perda de pacotes, ping alto. Quem apresenta avisa os outros se está limitado (action `qstat`), então quem assiste sabe se o problema é do lado de lá ou do seu.

```
src/
  app/page.tsx                  home: nome + criar sala / entrar com código
  app/sala/page.tsx             /sala?id=<código>
  components/RoomGate.tsx       valida o id e pede o nome se faltar
  components/room/RoomView.tsx  sala: barra do topo, palco, controles, participantes
  hooks/useRoom.ts              toda a lógica P2P: presença e compartilhamento (Trystero)
  hooks/useStreamStats.ts       estatísticas WebRTC e diagnóstico do ícone de qualidade
  lib/media.ts                  captura de tela, codec H.264 e teto de bitrate
  lib/                          id de sala, nome salvo, classes de estilo
```

## Limitações (por não ter servidor)

- **Relays de terceiros**: a descoberta depende dos relays públicos do Nostr. O Trystero usa vários ao mesmo tempo, mas eles não são nossos.
- **Redes restritas**: em NAT simétrico ou rede corporativa o WebRTC direto pode falhar. A solução é configurar um servidor TURN (`turnConfig` no `joinRoom`).
- **Upload de quem apresenta**: a tela é enviada separadamente pra cada pessoa (até 5). 1080p pra 5 pessoas pede ~24 Mbps de upload. Com menos que isso a resolução cai, mas a fluidez fica, e o ícone de qualidade mostra que o limite é a internet de envio. Tirar esse limite exigiria um servidor de mídia (SFU).
- **Celular**: dá pra assistir, mas não compartilhar. Os navegadores de celular não oferecem `getDisplayMedia`.
- **Áudio da tela**: só vai quando o navegador mostra a opção de áudio no seletor.
  - **Aba:** manda só o som da aba.
  - **Tela inteira (Windows):** manda o som do sistema todo.
  - **Janela, como um jogo:** o site pede só o som daquele programa (`windowAudio: "window"`, Chrome 141+). Se o navegador não oferecer essa opção, a janela vai sem som.
- **"Sala cheia" é best-effort**: sem autoridade central, a ordem de chegada usa o relógio de cada aparelho. Entradas simultâneas podem passar do limite por alguns segundos.
- **Código da sala = acesso**: quem tiver o link entra. Não há senha (o Trystero aceita `password` no `joinRoom` se precisar).
