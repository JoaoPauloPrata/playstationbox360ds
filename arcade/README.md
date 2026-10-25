# 🕹️ playstationbox360ds

Galeria de jogos que rodam no navegador do PC/TV, controlados pelo **celular** via QR code.

## Como rodar

```bash
cd arcade
npm install     # só na primeira vez
npm start
```

1. Abra **http://localhost:3000** no PC/TV (de preferência em tela cheia, F11).
2. Conecte o celular **no mesmo Wi-Fi** e escaneie o QR code da galeria.
3. Escolha o jogo com as setas do celular e toque em **JOGAR**.
4. Para voltar à galeria, use **☰ MENU** no celular ou `ESC` no PC.

O celular conecta **uma vez só**. Quando a tela abre um jogo ou volta para a galeria, o celular troca de controle sozinho e continua sendo o mesmo jogador (P1, P2...).

## App do controle (PWA)

O controle pode ser instalado na tela inicial do celular como um app:

- Abra **`/app/`** no celular e toque em **INSTALAR APP**. No iPhone: Compartilhar → "Adicionar à Tela de Início".
- O app abre em **tela cheia**, sem barra do navegador, com **zoom, rolagem e "puxar para atualizar" travados** e a orientação travada na horizontal nos jogos.
- Para conectar, toque em **ESCANEAR QR CODE** (câmera dentro do app) ou digite o **código de 4 letras** da TV.
- Quando a TV fecha a sala, o app oferece escanear de novo. Também aparece "voltar para a última sala" se ela ainda existir.

> ⚠️ **O app só instala e a câmera só funciona em HTTPS** (exigência dos navegadores; `localhost` é a única exceção).
> O servidor sobe em HTTPS automaticamente se existirem `certs/cert.pem` e `certs/key.pem` (porta 3443),
> ou aceita um endereço público com `PUBLIC_URL=https://...` (túnel ou nuvem). Sem HTTPS tudo continua
> funcionando pelo navegador, só sem a instalação e sem a câmera (dá para digitar o código).

## Produção (Vercel + Fly.io)

| Parte | Onde | Endereço |
|---|---|---|
| Páginas (galeria, jogos, app do controle) | Vercel, Root Directory `arcade`, preset `Other` | https://playstationbox360ds.vercel.app |
| Servidor de salas (WebSocket) | Fly.io, app `fliperama-arcade`, região `gru` | https://fliperama-arcade.fly.dev |

- A Vercel publica sozinha a cada push no GitHub. O build (`scripts/build-static.js`) gera `public/games/index.json`.
- O servidor é atualizado com `flyctl deploy --ha=false`. Ele precisa ficar em **uma máquina só**, porque as salas ficam na memória.
- `public/shared/config.js` decide o servidor: em `localhost` ou na rede local usa o próprio PC (`npm start`), e fora disso usa o Fly.
- O QR code aponta para o endereço em `PUBLIC_URL`, no `fly.toml`.
- A máquina do Fly desliga quando ninguém está jogando. A primeira conexão depois disso leva uns segundos.

## Jogos

| Jogo | Jogadores | Resumo |
|---|---|---|
| 🏎️ **Kart Party** | 1 | Corrida pseudo-3D estilo Super Nintendo, com drift, itens e 7 rivais |
| 🥊 **Pancadaria** | 1–2 | Luta 2D estilo fliperama. 1 celular joga contra a CPU, 2 celulares jogam P1 contra P2 |

### Pancadaria: lutadores

| Lutador | Estilo | ESPECIAL | ↑ + ESPECIAL | ↓ + ESPECIAL | SUPER |
|---|---|---|---|---|---|
| KENJI | karateca | Onda Ki (bola de energia) | Punho do Dragão (gancho voador) | Chute Furacão | Onda Ki Suprema |
| MEI LIN | kung fu, rápida | Esfera Kiko | Chute Celestial | Giro da Garça | Mil Chutes |
| ROCHA | militar | Lâmina Sônica | Chute Meia-Lua (salto mortal) | Joelhada | Meia-Lua Dupla |
| IGOR | luta livre, forte | Pilão Giratório (agarrão) | Laço Duplo (giro de braços) | Investida do Urso | Pilão Final |
| TROVÃO | fera elétrica | Bola de Canhão (rolando) | Salto Selvagem | Choque Elétrico | Tempestade Tropical |
| ASHA | ioga, braços longos | Sopro de Fogo | Chama Ioga | Teleporte | Inferno Ioga |

- Segurar **para trás** defende (agachado defende golpes baixos). **Para frente + SOCO** colado no adversário é um arremesso.
- Os comandos clássicos também funcionam: `↓↘→ + SOCO`, `→↓↘ + SOCO`, `↓↙← + CHUTE`.
- Teclado: P1 usa `WASD` + `J` soco, `K` chute, `L` especial, `I` super. P2 usa as setas + `N`, `M`, `,` e `.`.
- Depuração: `/games/pancadaria/?debug` expõe o estado em `window.__luta`.

## Estrutura

```
arcade/
├─ server.js                    servidor HTTP + WebSocket (salas)
└─ public/
   ├─ index.html, hub.js        galeria (tela)
   ├─ controller.html           controle da galeria (celular)
   ├─ shared/
   │  ├─ arcade-screen.js       SDK da tela
   │  └─ arcade-controller.js   SDK do controle
   └─ games/
      └─ kart/                  um jogo = uma pasta
         ├─ game.json           nome, descrição, capa... (aparece na galeria)
         ├─ cover.svg           capa do card
         ├─ index.html          tela do jogo
         └─ controller.html     controle do jogo no celular
```

## Como funciona a conexão

```
 Celular ──WebSocket──► servidor (sala ABCD) ──WebSocket──► Tela (galeria ou jogo)
         ◄─────────────                      ◄─────────────
```

- Cada **sala** tem 1 tela e N celulares. A sala guarda qual jogo está aberto.
- Quando a tela troca de página (galeria → jogo), ela reconecta na **mesma sala** e informa o jogo atual. O servidor manda os celulares para `/games/<id>/controller.html`.
- A sala espera a tela voltar por 20 s e o jogador por 4 s. Isso cobre recarregamentos e trocas de página sem ninguém "sair".

## Como adicionar um jogo novo

1. Crie a pasta `public/games/<id>/` (id em minúsculas, sem espaços).
2. Crie o `game.json`:

```json
{
  "name": "Meu Jogo",
  "description": "O que é o jogo.",
  "genre": "PUZZLE",
  "players": "1-4 JOGADORES",
  "controls": ["Setas: mover", "A: pular"],
  "icon": "🧩",
  "color": "#8e24aa",
  "cover": "cover.svg",
  "order": 2
}
```

3. Tela (`index.html`):

```html
<script src="/shared/arcade-screen.js"></script>
<script>
  const arcade = ArcadeScreen({
    game: '<id>',
    onRoom(info, players) { /* info.qr, info.code */ },
    onJoin(player, players) { /* player.pid, player.index */ },
    onLeave(player, players) {},
    onMessage(msg) { /* msg.pid, msg.index + o que o celular mandou */ },
    onReady(player) { /* celular (re)conectou: reenvie o estado para ele */ },
  });
  arcade.send({ t: 'algo' });          // para todos os celulares
  arcade.send({ t: 'algo' }, pid);     // para um celular
  arcade.exit();                       // volta para a galeria
</script>
```

4. Controle (`controller.html`):

```html
<script src="/shared/arcade-controller.js"></script>
<script>
  const pad = ArcadeController({
    game: '<id>',
    onJoined(me) { /* me.pid, me.index */ },
    onMessage(msg) {},
    onStatus(text, kind) {},
  });
  pad.send({ t: 'pular' });
  pad.exit();                          // pede para a tela voltar à galeria
</script>
```

Pronto. O jogo aparece na galeria sem mexer no servidor (basta recarregar a galeria).

## Importar ROMs (emulador)

Na galeria, clique em **+ IMPORTAR ROM** ou **arraste os arquivos** para a tela do PC/TV. Cada ROM vira um card e é jogada com o celular igual aos outros jogos.

| Console | Arquivos |
|---|---|
| NES · SNES · N64 | `.nes` `.fds` · `.sfc` `.smc` · `.n64` `.z64` `.v64` |
| Game Boy · Color · Advance · DS | `.gb` · `.gbc` · `.gba` · `.nds` |
| Mega Drive · Master System · Game Gear | `.md` `.gen` `.smd` `.bin` · `.sms` · `.gg` |
| PlayStation | `.cue` `.chd` `.pbp` `.bin` `.iso` (ou `.zip` com o .bin + .cue) |
| Fliperama (FBNeo) · PC Engine · Atari 2600/7800 | `.zip` `.7z` · `.pce` · `.a26` · `.a78` |

- O console é detectado pela extensão. `.zip` com uma ROM de console dentro usa aquele console; os outros são fliperama. `.bin` grande vira PS1 e pequeno vira Mega Drive. Se errar, troque em **CONSOLE** no painel de detalhes.
- **As ROMs ficam guardadas só no navegador do PC/TV** (IndexedDB). Nada é enviado para o servidor, nem na Vercel. Outro PC ou outro navegador precisa importar de novo.
- O emulador é o [EmulatorJS](https://emulatorjs.org), baixado de `cdn.emulatorjs.org` na primeira vez de cada console (precisa de internet).
- Cada celular é um jogador (P1 a P4). O controle mostra os botões do console da ROM; no N64 o direcional vira analógico.
- **☰ MENU** no celular: pausar, reiniciar, salvar/carregar o jogo (1 slot por ROM) e voltar à galeria. Os saves de bateria do próprio jogo são gravados sozinhos.
- Ao voltar para a galeria, a última imagem do jogo vira a capa do card. `ESC` no PC também volta.
- Os navegadores só liberam o **som** depois de um clique ou tecla na página: clique uma vez na TV quando aparecer o aviso.
- PS1 usa a BIOS interna do emulador. Alguns jogos de fliperama (Neo Geo etc.) precisam do zip da BIOS e podem não abrir.
- Use apenas ROMs de jogos que você tem o direito de usar.

Arquivos: `public/shared/retro-systems.js` (consoles, extensões e botões), `public/shared/rom-library.js` (biblioteca no IndexedDB) e `public/games/retro/` (tela e controle do emulador, escondido da galeria com `"hidden": true` no `game.json`).

## Problemas comuns

- **O celular não abre o link**: confira se está no mesmo Wi-Fi e se o Firewall do Windows liberou o Node.js em redes privadas.
- **O QR code aponta para o IP errado** (VPN ou várias placas de rede): no PowerShell, rode `$env:PUBLIC_HOST="192.168.x.x:3000"; npm start`.
- **Depuração do kart**: `http://localhost:3000/games/kart/?debug` expõe o estado em `window.__kart`.
