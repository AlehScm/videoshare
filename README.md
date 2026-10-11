# videoshare

Salas pra compartilhar a tela **sem backend próprio**. A pessoa escolhe um nome, cria uma sala e manda o link. Quem abrir o link entra na sala e assiste à tela de quem está apresentando.

**No ar:** https://alehscm.github.io/videoshare/
**App pra Windows:** https://github.com/AlehScm/videoshare/releases/latest

## Rodando

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # gera site 100% estático em out/
```

Para testar sozinho: abra o link da sala em duas abas (ou uma normal e uma anônima). Em cada aba dá pra usar um nome diferente.

## Deploy

Todo push na `master` publica no GitHub Pages pelo workflow `.github/workflows/deploy.yml`. Ele roda o build com `NEXT_PUBLIC_BASE_PATH=/videoshare`, porque o Pages serve o site nesse subcaminho. Localmente a variável fica vazia e o site roda na raiz.

## App de desktop (`desktop/`)

App pra Windows em Electron. Ele abre o próprio site, então entra nas mesmas salas e a interface se atualiza junto com o site. Quem assiste pode continuar pelo link no navegador.

- **Seletor de janelas e telas** do videoshare, com miniaturas, no lugar do seletor do navegador.
- **Som só do programa:** ao compartilhar uma janela (ex.: um jogo), o áudio vem só daquele processo, por captura de áudio por processo do WASAPI (`loopback-capture`; a janela vira PID via `koffi`). Na tela inteira vai o som do computador menos o próprio videoshare. O PCM chega na página por `MessagePort` e vira trilha num `AudioWorklet` (`src/lib/desktop.ts`).
- **Bandeja:** fechar a janela deixa o app perto do relógio. Pra sair: botão direito no ícone → Sair.
- **Atualização automática:** `electron-updater` busca versão nova no GitHub Releases.

```bash
cd desktop
npm install
npm start                                   # abre o app apontando pro site no ar
VIDEOSHARE_URL=http://localhost:3000/ npm start   # apontando pro site local
npm run dist                                # gera o instalador em desktop/release/
```

**Publicar versão nova:** suba o `version` em `desktop/package.json`, faça commit e crie a tag igual (`git tag v0.2.0 && git push --tags`). O workflow `.github/workflows/desktop.yml` gera o instalador e publica o Release, e os apps instalados se atualizam sozinhos.

O instalador não tem assinatura digital. Na primeira vez o Windows mostra "O Windows protegeu o computador": clique em "Mais informações" e depois em "Executar assim mesmo".

## Como funciona

- **Next.js com `output: "export"`**: o build é só HTML/CSS/JS e pode ser hospedado em qualquer lugar.
- **[Trystero](https://github.com/dmotz/trystero)**: os navegadores se encontram por relays públicos do Nostr (só pra trocar o "aperto de mão" do WebRTC). Depois a presença e a chave da transmissão vão direto de um navegador pro outro, P2P. A tela vai pelo servidor de vídeo (ver "Modo servidor"), com o P2P de reserva.
- **Presença**: cada participante manda `{ name, joinedAt, sharingSince }` ao conectar e de novo quando começa ou para de compartilhar.
- **Limite de 6 por sala** (`MAX_PER_ROOM` em `src/hooks/useRoom.ts`): quem chega além do limite vê "sala cheia" e sai sozinho.
- **Compartilhar tela**: qualquer pessoa, uma por vez. Quem apresenta captura com `getDisplayMedia` (com o áudio da aba ou do sistema, quando o navegador oferece) e manda 1 cópia pro servidor de vídeo. No modo P2P, manda uma cópia pra cada participante, inclusive pra quem entra depois. Se outra pessoa clicar em compartilhar enquanto alguém apresenta, aparece uma confirmação e a tela dela substitui a atual: vence quem começou por último.
- **Volume**: cada pessoa que assiste ajusta o volume (ou silencia) a tela compartilhada só no próprio computador, pelo controle no canto do palco. O valor fica salvo no navegador.
- **Qualidade escolhida por quem apresenta** (`src/lib/quality.ts`, `src/lib/media.ts`, `changePreset`/`retuneSenders` em `useRoom.ts`):
  - **Seletor:** fica ao lado de "Compartilhar tela". Opções de 480p, 720p ou 1080p a 30 ou 60 fps, padrão **720p · 30 fps**. A escolha fica salva no navegador.
  - **Troca ao vivo:** mudar durante a transmissão vale na hora (`applyConstraints` + `setParameters`).
  - **Resolução travada:** `degradationPreference: "maintain-resolution"`, e `scaleResolutionDownBy` garante que a captura não passe da escolhida. A resolução não desce sozinha. Se faltar banda ou processador, a imagem perde quadros e o ícone de qualidade sugere escolher uma qualidade menor.
  - **Taxa por qualidade:** 720p30 ≈ 2,5 Mbps, 1080p60 ≈ 7 Mbps por pessoa. O codec é o padrão do navegador.
- **Ícone de qualidade** (`src/hooks/useStreamStats.ts`, `QualityIndicator.tsx`): no canto do palco. Lê o `getStats()` a cada segundo e mostra:
  - **Pra quem assiste:** resolução, fps, taxa recebida, perda, ping, travadas e codec.
  - **Pra quem apresenta:** o envio pra cada pessoa.
  - **O problema em português:** internet de envio sem dar conta da qualidade escolhida, computador sobrecarregado, perda de pacotes, ping alto, travadas. A falta de banda é detectada comparando os quadros enviados com os capturados, pra não acusar tela parada. Quem apresenta avisa os outros (action `qstat`, com a qualidade escolhida e os fps capturados), então quem assiste sabe se o problema é do lado de lá ou do seu.
  - **Sem falso alarme:** poucos fps, travadas e "sem imagem" só contam quando a tela de quem apresenta está se mexendo. A perda é medida numa janela de 5 s. Cada problema só aparece depois de 3 medições seguidas e só some depois de 3 boas.
- **Repetidor automático** (`src/lib/relay.ts`, lógica em `useRoom.ts`): só no modo P2P. Quando a internet de envio de quem apresenta não dá conta, um amigo com upload melhor recebe 1 cópia e repassa pros outros.
  - **Quando liga:** quem apresenta está limitado (banda ou processador) há 8 s e tem 3 ou mais pessoas assistindo.
  - **Quem vira repetidor:** o computador com maior upload medido, que precisa aguentar `(pessoas − 1) × taxa da qualidade × 1,5`. O upload é medido assim: quem apresenta pede a cada computador ~2 MB por data channel (actions `probeReq`/`probeData`).
  - **Troca sem tela preta:** o repetidor repassa o stream recebido (`room.addStream` com a trilha remota). Cada pessoa confirma (`relayAck`) quando a cópia dele chegou, e só então quem apresenta desliga o envio direto pra ela.
  - **Se o repetidor sair:** quem apresenta volta a mandar direto. Se continuar limitado, escolhe outro repetidor.
  - **Custos:** ~100–200 ms a mais de atraso, e o navegador do repetidor recodifica o vídeo (perde um pouco de qualidade). O ícone de qualidade mostra o caminho ("Direto de Ana" / "Via Bruno (repetidor)"), e a lista de participantes marca o repetidor.

## Modo servidor (`src/lib/moq/`)

A tela vai sempre por um servidor de vídeo [MoQ](https://moq.dev) (Media over QUIC): quem apresenta codifica e envia **uma** cópia, e o servidor entrega pra todo mundo. No P2P eram uma codificação e um envio por pessoa, e era isso que derrubava o fps com a sala cheia.

- **Servidor:** o retransmissor público `https://cdn.moq.dev/anon`, sem conta nem cartão. Pra testar outro, grave a URL em `localStorage["videoshare:moqRelay"]`. Com `"off"`, o modo servidor fica desligado.
- **Envio** (`publisher.ts`):
  - **Caminho:** `MediaStreamTrackProcessor` → `VideoEncoder`/`AudioEncoder` (WebCodecs) → criptografia → `@moq/net`, com trilhas `v` e `a` num broadcast de nome aleatório.
  - **Vídeo:** H.264 pela placa de vídeo quando der, senão VP8. Um grupo por quadro-chave, a cada 2 s, com a config do decoder no começo, então quem entra no meio começa limpo.
  - **Tela parada:** a captura não gera quadros, então o último é reenviado 1×/s.
  - **Áudio:** Opus 128 kbps.
- **Recebimento** (`subscriber.ts`):
  - **Caminho:** `@moq/net` → descriptografia → `VideoDecoder`/`AudioDecoder`.
  - **Saída:** o vídeo vira trilha por `MediaStreamTrackGenerator`, e o áudio passa pelo mesmo player PCM do app de desktop. Sai um `MediaStream` comum, então palco, tela cheia e volume funcionam igual.
- **Criptografia** (`crypto.ts`):
  - **Chave:** cada quadro é cifrado com AES-GCM-128. A chave é nova a cada transmissão e só circula dentro da sala, pelo canal P2P do Trystero (action `mkey`). Quem entra depois recebe a chave ao entrar.
  - **Saída de alguém:** a chave é trocada e enviada só pra quem ficou.
  - **Desconhecidos:** quem achar o broadcast no servidor recebe só bytes embaralhados.
- **Reserva P2P:** o P2P assume nestes casos:
  - **Servidor fora:** não conectou em 6 s ou caiu por mais de 8 s. Aí volta tudo pro P2P de antes.
  - **Navegador sem suporte:** quem não consegue assistir pelo servidor (Firefox, Safari) recebe por P2P. Quem assiste também pede o P2P (action `moqFail`) se ficar 10 s sem imagem.
- **Ícone de qualidade:** mostra "Via servidor (criptografado)". Quem apresenta vê os fps capturados e enviados, a taxa, o codec e se o computador está descartando quadros.

```
src/
  app/page.tsx                  home: nome + criar sala / entrar com código
  app/sala/page.tsx             /sala?id=<código>
  components/RoomGate.tsx       valida o id e pede o nome se faltar
  components/room/RoomView.tsx  sala: barra do topo, palco, controles, participantes
  hooks/useRoom.ts              toda a lógica P2P: presença e compartilhamento (Trystero)
  hooks/useStreamStats.ts       estatísticas WebRTC e diagnóstico do ícone de qualidade
  lib/moq/                      modo servidor: envio, recebimento, criptografia e suporte do navegador
  lib/relay.ts                  regras do repetidor automático e medição do upload
  lib/media.ts                  captura de tela e ajuste do envio (resolução, fps, bitrate)
  lib/quality.ts                opções de qualidade (480p a 1080p, 30/60 fps) e taxas
  lib/desktop.ts                ponte com o app de desktop e trilha de áudio vinda do Windows
  components/room/SourcePicker.tsx  seletor de janelas/telas (só no app)
  lib/                          id de sala, nome salvo, classes de estilo
desktop/
  src/main.ts                   janela, bandeja, permissões, atualização automática
  src/capture.ts                lista de fontes, janela → PID, captura de áudio por processo
  src/preload.ts                window.videoshareDesktop (contextBridge)
```

## Limitações

- **Relays de terceiros**: a descoberta depende dos relays públicos do Nostr. O Trystero usa vários ao mesmo tempo, mas eles não são nossos.
- **Servidor de vídeo de terceiros**: o `cdn.moq.dev` é público, sem garantia, e pode mudar ou sair do ar. Nesse caso o P2P assume. As bibliotecas do MoQ são 0.x, por isso a versão fica fixa (`@moq/net` 0.4.2).
- **O que a criptografia não esconde**: desconhecidos veem que a transmissão existe, o nome aleatório e quanto tráfego ela gera, mas não o conteúdo.
- **Atraso**: o modo servidor tem ~0,4 s a mais que o P2P. Quem entra no meio espera até ~2 s pelo próximo quadro-chave.
- **Firefox e Safari**: não têm `MediaStreamTrackProcessor`/`MediaStreamTrackGenerator`, então apresentam e assistem pelo P2P.
- **Redes restritas**: em NAT simétrico ou rede corporativa o WebRTC direto pode falhar. A solução é configurar um servidor TURN (`turnConfig` no `joinRoom`). Isso afeta a presença e o modo P2P.
- **Upload no modo P2P**: a tela é enviada separadamente pra cada pessoa (até 5). Com 5 pessoas assistindo, 720p30 pede ~12,5 Mbps e 1080p60 ~35 Mbps de upload. Se não der conta e alguém na sala tiver upload melhor, o repetidor automático assume. Se ninguém tiver, a imagem perde quadros e o ícone avisa pra baixar a qualidade. No modo servidor é 1 cópia só.
- **Celular**: dá pra assistir, mas não compartilhar. Os navegadores de celular não oferecem `getDisplayMedia`.
- **Áudio da tela**: só vai quando o navegador mostra a opção de áudio no seletor.
  - **Aba:** manda só o som da aba.
  - **Tela inteira (Windows):** manda o som do sistema todo.
  - **Janela, como um jogo:** o site pede só o som daquele programa (`windowAudio: "window"`, Chrome 141+). Se o navegador não oferecer essa opção, a janela vai sem som. No app de desktop isso não depende do navegador.
- **App de desktop:**
  - **Windows:** só Windows 10 2004+ ou 11, x64.
  - **Anti-cheat:** a captura não injeta nada no jogo. O vídeo vem do Windows Graphics Capture e o áudio da captura por processo do WASAPI, ambos APIs oficiais do Windows, então o anti-cheat não tem o que bloquear.
  - **Tela cheia exclusiva:** jogos em tela cheia exclusiva aparecem pretos na captura de janela. Use o modo "janela sem bordas" do jogo ou compartilhe a tela inteira.
  - **Janela que bloqueia captura:** programas que marcam a janela como não capturável (`WDA_EXCLUDEFROMCAPTURE`) aparecem pretos, como no Discord sem injeção.
  - **Jogo como administrador:** se o jogo roda como administrador e a captura falhar, abra o videoshare como administrador também.
  - **Sincronia:** o som pode ficar ~50–150 ms fora de sincronia com a imagem.
- **"Sala cheia" é best-effort**: sem autoridade central, a ordem de chegada usa o relógio de cada aparelho. Entradas simultâneas podem passar do limite por alguns segundos.
- **Código da sala = acesso**: quem tiver o link entra. Não há senha (o Trystero aceita `password` no `joinRoom` se precisar).
