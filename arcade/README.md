# 🕹️ Fliperama

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

## Problemas comuns

- **O celular não abre o link**: confira se está no mesmo Wi-Fi e se o Firewall do Windows liberou o Node.js em redes privadas.
- **O QR code aponta para o IP errado** (VPN ou várias placas de rede): no PowerShell, rode `$env:PUBLIC_HOST="192.168.x.x:3000"; npm start`.
- **Depuração do kart**: `http://localhost:3000/games/kart/?debug` expõe o estado em `window.__kart`.
