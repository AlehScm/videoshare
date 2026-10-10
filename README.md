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
- **[Trystero](https://github.com/dmotz/trystero)**: os navegadores se encontram por relays públicos do Nostr (só pra trocar o "aperto de mão" do WebRTC). Depois a presença e a tela vão direto de um navegador pro outro, P2P.
- **Presença**: cada participante manda `{ name, joinedAt, sharingSince }` ao conectar e de novo quando começa ou para de compartilhar.
- **Limite de 6 por sala** (`MAX_PER_ROOM` em `src/hooks/useRoom.ts`): quem chega além do limite vê "sala cheia" e sai sozinho.
- **Compartilhar tela**: qualquer pessoa, uma por vez. Quem apresenta envia o stream do `getDisplayMedia` (com o áudio da aba ou do sistema, quando o navegador oferece) pra cada participante, inclusive pra quem entra depois. Se outra pessoa clicar em compartilhar enquanto alguém apresenta, aparece uma confirmação e a tela dela substitui a atual: vence quem começou por último.
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

```
src/
  app/page.tsx                  home: nome + criar sala / entrar com código
  app/sala/page.tsx             /sala?id=<código>
  components/RoomGate.tsx       valida o id e pede o nome se faltar
  components/room/RoomView.tsx  sala: barra do topo, palco, controles, participantes
  hooks/useRoom.ts              toda a lógica P2P: presença e compartilhamento (Trystero)
  hooks/useStreamStats.ts       estatísticas WebRTC e diagnóstico do ícone de qualidade
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

## Limitações (por não ter servidor)

- **Relays de terceiros**: a descoberta depende dos relays públicos do Nostr. O Trystero usa vários ao mesmo tempo, mas eles não são nossos.
- **Redes restritas**: em NAT simétrico ou rede corporativa o WebRTC direto pode falhar. A solução é configurar um servidor TURN (`turnConfig` no `joinRoom`).
- **Upload de quem apresenta**: a tela é enviada separadamente pra cada pessoa (até 5). Com 5 pessoas assistindo, 720p30 pede ~12,5 Mbps e 1080p60 ~35 Mbps de upload. Se não der conta, a imagem perde quadros e o ícone avisa pra baixar a qualidade. Tirar esse limite exigiria um servidor de mídia (SFU).
- **Celular**: dá pra assistir, mas não compartilhar. Os navegadores de celular não oferecem `getDisplayMedia`.
- **Áudio da tela**: só vai quando o navegador mostra a opção de áudio no seletor.
  - **Aba:** manda só o som da aba.
  - **Tela inteira (Windows):** manda o som do sistema todo.
  - **Janela, como um jogo:** o site pede só o som daquele programa (`windowAudio: "window"`, Chrome 141+). Se o navegador não oferecer essa opção, a janela vai sem som. No app de desktop isso não depende do navegador.
- **App de desktop:**
  - **Windows:** só Windows 10 2004+ ou 11, x64.
  - **Jogos protegidos:** jogos com anti-cheat ou rodando como administrador podem bloquear a captura de áudio por processo. Nesse caso, use a tela inteira.
  - **Sincronia:** o som pode ficar ~50–150 ms fora de sincronia com a imagem.
- **"Sala cheia" é best-effort**: sem autoridade central, a ordem de chegada usa o relógio de cada aparelho. Entradas simultâneas podem passar do limite por alguns segundos.
- **Código da sala = acesso**: quem tiver o link entra. Não há senha (o Trystero aceita `password` no `joinRoom` se precisar).
