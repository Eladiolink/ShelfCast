# ShelfCast

Aplicação para **Linux** que transforma seus servidores **DLNA/UPnP** (MiniDLNA, ReadyMedia, Jellyfin, etc.) em uma **biblioteca pessoal de streaming** acessível pelo navegador.

- 🔎 Detecta automaticamente servidores DLNA na rede (SSDP/UPnP)
- 🗂️ Navega recursivamente pelo ContentDirectory (com paginação)
- 🎬 Identifica filmes, séries, animes e animações a partir do nome do arquivo
- 🎴 Busca metadados públicos (TMDB, TVMaze, AniList, Jikan): pôster, descrição, elenco, avaliação…
- ▶️ Reproduz no navegador com streaming por **Range Requests** e **transcodificação via FFmpeg** quando necessário
- ⏯️ Continua assistindo de onde parou (progresso salvo)
- 🖥️ Funciona como **serviço systemd** em segundo plano
- 🧩 Sem dependências externas — Node.js + SQLite nativos

Os vídeos **não são copiados** para o computador: permanecem no servidor DLNA e são transmitidos pela rede. Localmente são armazenados apenas metadados, banco de dados, pôsteres, thumbnails e cache.

---

## Requisitos

| Dependência | Versão mínima | Necessário para |
|---|---|---|
| Node.js | 22.5+ | Executar a aplicação |
| FFmpeg (opcional) | qualquer | Transcodificação de formatos não suportados pelo navegador |

Verifique:

```bash
node -v      # >= 22.5
ffmpeg -version   # opcional
```

## Instalação

### Rápida (recomendada)

```bash
chmod +x install.sh
./install.sh
```

O instalador verifica dependências, copia a aplicação para `~/.var/shelfcast` (instalação por usuário, sem `sudo`), cria `.env` padrão, configura e inicia o serviço systemd de usuário. Ao final:

```
✓ Aplicação instalada
Acesse:
http://localhost:8080
```

### Manual

```bash
git clone <repositorio> shelfcast && cd shelfcast
cp .env.example .env
node src/index.js
```

### Docker (opcional)

> **Importante:** a descoberta SSDP/DLNA usa multicast. O container **deve** rodar com `network_mode: host`, senão não encontrará os servidores na rede.

```bash
docker compose up -d
```

## Configuração

Edite o arquivo `.env` (crie a partir de `.env.example`):

```env
HOST=0.0.0.0
PORT=8080
SCAN_INTERVAL=30m
ENABLE_METADATA=true
TMDB_API_KEY=            # chave gratuita em themoviedb.org
FFMPEG_PATH=ffmpeg
LOG_LEVEL=info
```

A aplicação funciona **sem nenhuma API configurada** (TVMaze e Jikan não exigem chave). Se nenhuma API estiver disponível, exibe apenas os metadados vindos do DLNA.

## Como iniciar

```bash
node src/index.js
# ou
npm start
```

Abra **http://localhost:8080** (ou `http://IP-DO-PC:8080` na rede local).

### Primeiro acesso

1. A aplicação descobre os servidores DLNA automaticamente.
2. Selecione **“Buscar servidores DLNA”** na página de Servidores.
3. Clique em **Sincronizar agora** no servidor encontrado.
4. Aguarde a varredura (barra de progresso na página de Servidores).
5. Navegue pela biblioteca: Home → Filmes / Séries / Animes.

## Acesso pelo navegador

A interface funciona em desktop, notebook, tablet e celular. Prioriza cards grandes e navegação por teclado (estilo media center):

- `/` — Home (continuar assistindo, recentes, filmes, séries, animes)
- `#/movies`, `#/series`, `#/anime` — bibliotecas com filtros (ano, gênero, resolução, codec)
- `#/search` — busca global (tecla `/`)
- `#/media/:id` — detalhes, fontes, episódios
- `#/servers` — servidores DLNA (status, sincronização, erros)
- `#/settings` — configurações, diagnóstico FFmpeg, logs

Atalhos no player: `Espaço`/`K` play/pause · `←`/`→` retroceder/avançar 10s · `M` mudo · `F` tela cheia · `Esc` sair.

## APIs de metadados

A arquitetura usa a abstração `MetadataProvider` — fácil adicionar novos provedores:

```
MetadataProvider
├── TMDBProvider      (filmes e séries — requer chave)
├── TVMazeProvider    (séries — sem chave)
├── AniListProvider   (animes — sem chave)
└── JikanProvider     (animes/MyAnimeList — sem chave)
```

Configure a chave do TMDB no `.env`:

```env
TMDB_API_KEY=SUA_CHAVE_AQUI
```

Cada provedor implementa `search()`, `getMovie()`, `getSeries()`, `getEpisode()`, `getAnime()`. Os resultados são **armazenados em cache** (banco + pôsteres locais) — nenhuma chamada é repetida a cada abertura de página.

## Como funciona a descoberta DLNA

1. A aplicação envia `M-SEARCH` (SSDP) para `239.255.255.250:1900` pedindo dispositivos MediaServer.
2. Para redes onde o roteador/AP bloqueia multicast (comum em **WiFi**), ela também:
   - envia M-SEARCH para o **broadcast** da sub-rede (`192.168.x.255`);
   - faz uma **varredura unicast** de toda a sub-rede, enviando M-SEARCH diretamente a cada IP;
   - mantém um **listener persistente** que captura anúncios **NOTIFY** (`ssdp:alive`).
3. Cada dispositivo responde com sua **LOCATION** (URL da descrição).
4. A aplicação baixa o XML de descrição, identifica `friendlyName`, modelo, fabricante.
5. Localiza o serviço `ContentDirectory` e obtém a `controlURL`.
6. O servidor é salvo no banco (nome, IP, porta, URLs, serviços) e sincronizado.

A descoberta roda ao iniciar, periodicamente (padrão `10m`) e quando você clica em “Buscar servidores”.

**Se o servidor ainda não aparecer**, adicione manualmente pelo IP na página **Servidores DLNA → Adicionar manualmente** — a aplicação sondará caminhos UPnP comuns (`/rootDesc.xml`, `/description.xml`…) e fará M-SEARCH unicast direto ao host.

## Como funciona a sincronização

```
Descobrir servidor → Conectar → Obter ContentDirectory → Percorrer diretórios
→ Encontrar mídias → Comparar com o banco → Adicionar novas → Atualizar existentes
→ Marcar/remover desaparecidas → Buscar metadados → Finalizar
```

- A varredura é **recursiva**, sem limite fixo de profundidade, com paginação (não carrega tudo na memória).
- Itens removidos do servidor são mantidos por 7 dias como “missing” antes de apagar, para preservar o histórico.
- A sincronização roda em **jobs assíncronos** — a interface nunca é bloqueada e você pode cancelar.
- Varreduras periódicas usam `SCAN_INTERVAL` (padrão `30m`).

## Configuração do FFmpeg

Para formatos que o navegador não reproduz diretamente (ex.: MKV/HEVC em alguns casos), a aplicação transcodifica em tempo real:

```env
ENABLE_TRANSCODE=true
FFMPEG_PATH=ffmpeg
```

- O navegador faz **direct play** quando o formato é suportado — nenhuma transcodificação é feita desnecessariamente.
- Transcodificação usa **argumentos estruturados** (nunca concatena entrada do usuário em shell).
- Teste o diagnóstico na página **Configurações → Testar FFmpeg**.

## Aplicação desktop (Electron)

Além da página web, o projeto inclui uma **aplicação desktop Electron**.

- Tudo toca **dentro da janela do app** — MP4/WebM em direct play no Chromium, e **MKV/outros via remux** (FFmpeg copia os codecs, rápido, sem re-encode pesado).
- Botão **🎬 mpv** no player: abre a reprodução no **mpv nativo** (opcional, para quem prefere decode por hardware e todos os codecs) — o mpv abre em sua própria janela.
- O app inicia o servidor automaticamente (caso não esteja rodando) e mantém um ícone na **bandeja**.
- O progresso é salvo de volta na biblioteca ("Continuar assistindo").

> **Por que não embutir o mpv dentro da janela do Electron?** O Chromium do Electron não demuxa Matroska, e embutir o player nativo de verdade exige um **addon compilado** (libmpv render API / X11 `--wid`), que é frágil entre distribuições e versões. O remux via servidor é a forma confiável de reproduzir MKV dentro da própria janela.

Instalação (uma vez):

```bash
npm install
npm run desktop:install   # baixa o Electron
```

Executar:

```bash
npm run desktop
```

Requisitos: Linux com display. O mpv é **opcional** (usado apenas no botão "🎬 mpv").

> Em ambientes sem display (servidores headless) a interface desktop não abre; use a página web.

## Como executar como serviço

Após `install.sh`, o serviço de usuário `shelfcast` fica ativo (o instalador ativa `loginctl enable-linger`, então o serviço inicia no boot mesmo sem login):

```bash
systemctl --user status shelfcast
journalctl --user -u shelfcast -f   # logs
systemctl --user restart shelfcast
systemctl --user stop shelfcast
```

Para instalação **em todo o sistema** (`/opt` + systemd global), use a unidade incluída:

```bash
sudo cp systemd/shelfcast@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now shelfcast@$USER
```

## Estrutura do projeto

```
src/
├── index.js           entrada principal
├── server.js          HTTP server + arquivos estáticos
├── api/router.js      API REST
├── config/            config (.env) + logger estruturado
├── database/          SQLite (node:sqlite) + repositories
├── dlna/              SSDP discovery, XML, ContentDirectory
├── library/           identificação de mídias + scanner
├── metadata/          providers (TMDB/TVMaze/AniList/Jikan) + matching
├── playback/          streaming (Range) + FFmpeg
├── jobs/              fila de jobs assíncronos
└── cache/             cache de imagens
public/                frontend (JS puro, sem build)
test/                  testes automatizados (node:test)
```

## Testes

```bash
npm test
```

Cobrem: identificação de nomes, parser XML, parsing DIDL-Lite, banco/repositórios, matching de metadados e endpoints da API.

## API REST

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/servers` | Lista servidores DLNA |
| POST | `/api/servers/discover` | Força descoberta SSDP |
| GET | `/api/servers/:id` | Detalhes do servidor |
| POST | `/api/servers/:id/scan` | Sincroniza o servidor |
| POST | `/api/servers/:id/rescan` | Re-sincronização completa |
| POST | `/api/servers/:id/check` | Verifica conectividade |
| POST | `/api/servers/:id/pause` | Pausa/retoma sincronização |
| DELETE | `/api/servers/:id` | Remove servidor (biblioteca local preservada) |
| GET | `/api/media` | Lista mídias (paginada, filtros, busca) |
| GET | `/api/media/:id` | Detalhes (filme/série, episódios, pessoas) |
| GET | `/api/media/:id/stream` | Streaming (Range) |
| GET | `/api/media/:id/thumbnail` | Pôster/thumbnail |
| POST | `/api/media/:id/progress` | Salva progresso de reprodução |
| GET | `/api/movies` · `/api/series` · `/api/anime` | Bibliotecas por tipo |
| GET | `/api/search?q=` | Busca global |
| GET | `/api/jobs` · `/api/jobs/:id` · `/api/jobs/:id/cancel` | Jobs |
| GET | `/api/history` | Histórico de reprodução |
| GET | `/api/filters` | Opções de filtro |
| GET | `/api/dashboard` | Dados da Home |
| GET | `/api/settings` · `/api/system/info` · `/api/system/logs` | Sistema |

## Solução de problemas

**Não encontra servidores DLNA**
- Confirme que o servidor está na mesma rede/sub-rede.
- Alguns roteadores bloqueiam multicast entre VLANs — teste na mesma VLAN.
- Verifique se a porta UDP 1900 não está bloqueada por firewall.
- No Docker, use `network_mode: host`.

**Servidor aparece offline**
- Clique em **Verificar conexão** na página de Servidores.
- A biblioteca local continua disponível mesmo com o servidor offline.

**Vídeo não reproduz**
- Se o formato não for suportado pelo navegador, o botão ⚡ no player ativa a transcodificação (requer FFmpeg).
- Teste o FFmpeg em **Configurações → Testar FFmpeg**.

**Sem pôsteres/informações**
- Séries usam TVMaze; animes usam AniList/Jikan — todos **sem chave**.
- Filmes usam TMDB (requer `TMDB_API_KEY`); sem chave, **filmes de anime** são casados automaticamente via AniList/Jikan.
- Metadados são buscados em segundo plano; aguarde ou use **Configurações → Buscar metadados**.

**Logs**
- Arquivos estruturados em `data/logs/` ou `journalctl -u shelfcast -f`.
- Defina `LOG_LEVEL=debug` para mais detalhes.

**Limpar dados**
- Pare o serviço e remova `data/` (banco + cache) para começar do zero.
