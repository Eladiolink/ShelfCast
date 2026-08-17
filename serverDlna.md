# Prompt — Aplicação de mídia DLNA para Linux

## 1. Objetivo do projeto

Crie uma aplicação para **Linux** que funcione como um servidor/aplicação de mídia local, capaz de:

1. Detectar automaticamente servidores **DLNA/UPnP Media Server** disponíveis na rede local.
2. Conectar-se aos servidores encontrados sem exigir configuração manual complexa.
3. Navegar pela estrutura de pastas e conteúdos disponibilizados pelo servidor DLNA.
4. Fazer uma varredura completa do conteúdo disponível.
5. Criar uma biblioteca de mídia organizada em uma **galeria web**.
6. Identificar automaticamente filmes, séries, animes, desenhos/animações e outros vídeos.
7. Buscar metadados públicos sobre cada mídia utilizando APIs públicas.
8. Exibir pôster, título, descrição, ano, gêneros, avaliação, elenco, temporadas/episódios e outras informações relevantes.
9. Permitir reproduzir os vídeos diretamente pelo navegador.
10. Continuar funcionando em segundo plano como um serviço no Linux.
11. Disponibilizar a interface através de um navegador web na rede local.

A aplicação deve priorizar **simplicidade, estabilidade, baixo consumo de recursos e boa experiência de uso em uma rede doméstica**.

---

# 2. Arquitetura geral

Antes de implementar, defina uma arquitetura modular.

A aplicação deverá possuir pelo menos estes componentes:

```text
┌─────────────────────────────────────────────┐
│              Interface Web                  │
│                                             │
│  Biblioteca │ Filmes │ Séries │ Animes      │
│  Pesquisa   │ Detalhes │ Player             │
└──────────────────────┬──────────────────────┘
                       │ HTTP / REST
                       ▼
┌─────────────────────────────────────────────┐
│              Backend da aplicação           │
│                                             │
│  API REST                                   │
│  Gerenciador da biblioteca                  │
│  Gerenciador de metadados                   │
│  Gerenciador de reprodução                  │
│  Banco de dados                              │
└───────────┬──────────────────┬──────────────┘
            │                  │
            ▼                  ▼
┌──────────────────┐   ┌──────────────────────┐
│ Descoberta DLNA  │   │ APIs de metadados    │
│ UPnP / SSDP      │   │ TMDB / TVMaze etc.   │
└────────┬─────────┘   └──────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│             Servidores DLNA                 │
│                                             │
│ MiniDLNA │ Jellyfin DLNA │ ReadyMedia etc. │
└─────────────────────────────────────────────┘
```

Escolha tecnologias adequadas para Linux e justifique brevemente as escolhas.

Dê preferência a uma arquitetura que possa ser executada facilmente em distribuições como:

- Ubuntu
- Debian
- Arch Linux
- Fedora
- Manjaro

---

# 3. Descoberta automática de servidores DLNA

Implemente a descoberta automática utilizando **UPnP/SSDP**.

A aplicação deverá:

1. Detectar dispositivos DLNA na rede local.
2. Enviar solicitações SSDP apropriadas.
3. Identificar dispositivos que fornecem serviços de Media Server.
4. Obter a descrição XML do dispositivo.
5. Identificar o endpoint `ContentDirectory`.
6. Armazenar as informações do servidor descoberto.

Para cada servidor encontrado, armazene:

```text
Nome
Fabricante
Modelo
IP
Porta
URL de controle
URL de descrição
Serviços disponíveis
```

A descoberta deverá ser executada:

- Ao iniciar a aplicação.
- Periodicamente em segundo plano.
- Quando o usuário solicitar uma nova varredura.

Não presuma que o servidor terá um IP fixo.

---

# 4. Gerenciamento dos servidores

Crie uma seção chamada **Servidores DLNA**.

Ela deverá mostrar:

```text
Servidor
Status
IP
Última sincronização
Quantidade de mídias
```

Exemplo:

```text
Media Server
Online
192.168.1.50
Sincronizado há 5 minutos
1.842 vídeos
```

Permita:

- Atualizar servidor.
- Forçar nova varredura.
- Remover servidor da biblioteca.
- Pausar sincronização.
- Visualizar erros.
- Verificar conectividade.

Caso o servidor fique offline, a aplicação não deverá apagar imediatamente a biblioteca local.

---

# 5. Navegação do ContentDirectory

Utilize o serviço DLNA `ContentDirectory`.

A aplicação deverá navegar recursivamente pela árvore de conteúdo.

Exemplo:

```text
Servidor DLNA
├── Filmes
│   ├── Filme A.mkv
│   ├── Filme B.mp4
│   └── ...
├── Séries
│   ├── Série A
│   │   ├── Season 01
│   │   └── Season 02
│   └── Série B
└── Animes
    ├── Anime A
    └── Anime B
```

Não limite a implementação a uma profundidade fixa.

A aplicação deverá continuar navegando até encontrar os itens de mídia.

Utilize paginação quando o servidor DLNA retornar grandes quantidades de itens.

Não carregue milhares de arquivos simultaneamente na memória.

---

# 6. Identificação das mídias

Para cada item encontrado, extraia todas as informações disponíveis pelo servidor DLNA.

Quando disponíveis, utilize:

- título
- nome original
- URL de reprodução
- duração
- resolução
- codec de vídeo
- codec de áudio
- tamanho
- formato
- MIME type
- bitrate
- data
- álbum
- artista
- gênero
- descrição
- imagem/thumbnail
- número do episódio
- temporada

Crie um modelo interno de mídia.

Exemplo:

```text
MediaItem
├── id
├── server_id
├── parent_id
├── title
├── original_title
├── type
├── media_type
├── url
├── duration
├── format
├── video_codec
├── audio_codec
├── width
├── height
├── thumbnail
├── season
├── episode
├── metadata_status
└── last_seen
```

---

# 7. Identificação de filmes, séries e animes

Crie um sistema de normalização de nomes.

Por exemplo:

```text
Breaking.Bad.S01E01.720p.mkv
```

deverá ser interpretado como:

```text
Título: Breaking Bad
Temporada: 1
Episódio: 1
```

Também reconheça padrões como:

```text
S01E05
1x05
Season 01 Episode 05
02 - 12
```

Para filmes, remova informações técnicas do nome:

```text
The.Matrix.1999.1080p.BluRay.x264.mkv
```

deve gerar uma busca próxima de:

```text
The Matrix
Ano: 1999
```

Tenha cuidado para não remover palavras que fazem parte do título.

Implemente um mecanismo de confiança:

```text
match_confidence = 0.0 - 1.0
```

Não associe automaticamente um resultado de API quando a confiança for muito baixa.

---

# 8. APIs públicas de metadados

Utilize APIs públicas apropriadas para enriquecer a biblioteca.

Priorize serviços como:

- **TMDB**
- **TVMaze**
- outras APIs públicas adequadas para filmes e séries.

Para animes, avalie APIs públicas especializadas, como:

- AniList
- Jikan/MyAnimeList

A arquitetura deve permitir trocar ou adicionar provedores posteriormente.

Crie uma abstração:

```text
MetadataProvider
├── TMDBProvider
├── TVMazeProvider
└── AniListProvider
```

Cada provedor deverá implementar operações semelhantes a:

```text
search()
getMovie()
getSeries()
getEpisode()
getAnime()
```

Não coloque chamadas diretamente espalhadas pelo código.

---

# 9. Chaves de API

Não coloque chaves de API diretamente no código.

Utilize:

```text
.env
```

ou arquivo de configuração apropriado.

Exemplo:

```text
TMDB_API_KEY=
ANILIST_ENABLED=true
TVMAZE_ENABLED=true
```

Se uma API não exigir chave, não invente uma.

A aplicação deverá continuar funcionando mesmo que nenhuma API externa esteja configurada.

Nesse caso, exiba apenas os metadados disponíveis pelo DLNA.

---

# 10. Sistema de correspondência de metadados

Quando encontrar um vídeo:

```text
The.Lord.of.the.Rings.The.Fellowship.of.the.Ring.2001.1080p.mkv
```

execute:

```text
1. Normalizar nome
2. Extrair ano
3. Detectar tipo
4. Consultar provedores
5. Comparar resultados
6. Calcular confiança
7. Selecionar melhor correspondência
8. Salvar metadados
9. Salvar pôster/backdrop
10. Associar à mídia
```

Não faça uma nova consulta à API toda vez que o usuário abrir a página.

Implemente cache.

---

# 11. Banco de dados

Utilize um banco de dados local.

Para a primeira versão, prefira:

**SQLite**

O banco deverá armazenar pelo menos:

```text
servers
media
movies
series
seasons
episodes
metadata
genres
people
scan_jobs
playback_history
```

Crie índices apropriados para:

- título
- tipo
- servidor
- temporada
- episódio
- ano
- gênero

A biblioteca deverá continuar disponível mesmo quando o servidor DLNA estiver temporariamente offline.

---

# 12. Sistema de sincronização

Crie um serviço de sincronização em segundo plano.

Fluxo:

```text
Descobrir servidor
        ↓
Conectar
        ↓
Obter ContentDirectory
        ↓
Percorrer diretórios
        ↓
Encontrar mídias
        ↓
Comparar com banco local
        ↓
Adicionar novas mídias
        ↓
Atualizar mídias existentes
        ↓
Remover/identificar mídias desaparecidas
        ↓
Buscar metadados
        ↓
Finalizar sincronização
```

Não bloqueie a interface durante a sincronização.

Mostre progresso:

```text
Sincronizando...

1.234 / 4.500 itens

27%
```

Permita cancelar a sincronização.

---

# 13. Sistema de jobs

Utilize jobs assíncronos para tarefas demoradas:

```text
DLNA Discovery
Library Scan
Metadata Fetch
Thumbnail Processing
Cleanup
```

Evite executar essas tarefas diretamente dentro das requisições HTTP.

Implemente controle de concorrência para não sobrecarregar:

- servidor DLNA
- APIs externas
- CPU
- memória
- banco de dados

---

# 14. Galeria da biblioteca

A interface principal deverá ser semelhante a uma plataforma de streaming.

Crie:

```text
Home
├── Continuar assistindo
├── Adicionados recentemente
├── Filmes
├── Séries
├── Animes
├── Animações
├── Gêneros
└── Servidores
```

Os cards deverão mostrar:

```text
┌─────────────────────┐
│                     │
│      PÔSTER         │
│                     │
├─────────────────────┤
│ The Matrix          │
│ 1999                 │
│ ⭐ 8.7               │
└─────────────────────┘
```

Utilize thumbnails/pôsteres obtidos das APIs de metadados quando disponíveis.

---

# 15. Página de detalhes

Ao clicar em uma mídia, exiba:

```text
Pôster
Título
Título original
Ano
Avaliação
Duração
Gêneros
Descrição
Elenco
Diretor
Resolução
Codec
Servidor
```

Para séries:

```text
Série
├── Temporada 1
│   ├── Episódio 1
│   ├── Episódio 2
│   └── ...
├── Temporada 2
└── ...
```

Para animes, permita organizar por:

```text
Anime
├── Temporadas
├── Episódios
├── OVAs
└── Filmes
```

---

# 16. Reprodução dos vídeos

A aplicação deverá permitir assistir aos vídeos diretamente pelo navegador.

Crie um player HTML5.

Quando possível, utilize diretamente a URL fornecida pelo servidor DLNA.

Porém, não assuma que todos os navegadores suportam todos os formatos.

Considere suporte para:

```text
MP4
MKV
WebM
AVI
MPEG
H.264
H.265/HEVC
AAC
AC3
DTS
```

Quando o navegador não puder reproduzir diretamente o conteúdo, implemente uma camada opcional de **transcodificação/remux** usando **FFmpeg**.

Arquitetura:

```text
Browser
   ↓
Media API
   ↓
Playback Manager
   ↓
DLNA Media URL
   ↓
FFmpeg (se necessário)
   ↓
HTTP Stream
   ↓
Browser
```

Não transcodifique automaticamente se o navegador puder fazer direct play.

---

# 17. Streaming HTTP

Crie endpoints como:

```text
GET /api/media/:id
GET /api/media/:id/stream
GET /api/media/:id/thumbnail
```

O endpoint de streaming deverá suportar:

```text
Range Requests
```

Isso é obrigatório para permitir:

- avançar no vídeo
- retroceder
- continuar reprodução
- seek
- reprodução eficiente

Não carregue o arquivo inteiro na memória.

O streaming deverá ser feito em fluxo.

---

# 18. Controle de reprodução

Implemente:

```text
Play
Pause
Seek
Volume
Fullscreen
Playback position
```

Salve automaticamente o progresso:

```text
Usuário
Mídia
Posição atual
Duração
Última reprodução
```

Na próxima vez que o usuário abrir o vídeo:

```text
Continuar de 42:37?
```

---

# 19. Legendas

Investigue e implemente suporte a legendas quando forem disponibilizadas pelo servidor DLNA.

Quando possível:

```text
Português
Inglês
Espanhol
```

Permita selecionar a legenda no player.

Se o DLNA fornecer legendas incompatíveis com o navegador, avalie conversão através do FFmpeg.

---

# 20. Pesquisa

Implemente uma pesquisa global.

O usuário deverá conseguir pesquisar:

```text
Matrix
Breaking Bad
One Piece
Batman
```

A pesquisa deverá procurar em:

- título
- título original
- descrição
- gênero
- atores
- diretor
- nome da série
- nome do episódio

Utilize busca eficiente no banco.

---

# 21. Filtros

Adicione filtros:

```text
Tipo
├── Filme
├── Série
├── Anime
└── Animação

Ano

Gênero

Servidor

Resolução
├── 4K
├── 1080p
├── 720p
└── SD

Codec
├── H.264
├── H.265
└── AV1
```

---

# 22. Interface responsiva

A interface deverá funcionar em:

- Desktop Linux
- Notebook
- Tablet
- Celular

Priorize uma interface de **TV/media center**, com:

- cards grandes
- navegação por teclado
- suporte a fullscreen
- player em tela cheia
- controles simples

---

# 23. Funcionamento em segundo plano

A aplicação deverá funcionar como serviço Linux.

Crie uma unidade:

```text
media-server.service
```

ou nome semelhante.

O serviço deverá:

```text
 iniciar automaticamente
 executar em background
 reiniciar em caso de falha
 armazenar logs
 executar sincronizações periódicas
```

Exemplo:

```text
systemctl --user enable shelfcast
systemctl --user start shelfcast
```

Prefira um serviço de usuário quando não forem necessários privilégios administrativos.

---

# 24. Interface web

A aplicação deverá disponibilizar a interface em algo como:

```text
http://localhost:PORTA
```

e opcionalmente:

```text
http://IP-DO-PC:PORTA
```

Permita configurar:

```text
PORT=8080
HOST=0.0.0.0
```

Não exponha a aplicação publicamente por padrão.

A aplicação deve assumir que está sendo executada em uma rede doméstica confiável.

---

# 25. Configuração

Crie um arquivo de configuração simples.

Exemplo:

```text
HOST=0.0.0.0
PORT=8080

DATABASE_PATH=./data/library.db

SCAN_INTERVAL=30m

ENABLE_METADATA=true
TMDB_API_KEY=

FFMPEG_PATH=ffmpeg

LOG_LEVEL=info
```

Não obrigue o usuário a editar dezenas de opções para iniciar a aplicação.

---

# 26. Logs

Implemente logs estruturados.

Registre:

```text
Servidor descoberto
Servidor desconectado
Início de sincronização
Fim de sincronização
Erro DLNA
Erro HTTP
Erro de metadata
Erro FFmpeg
Erro de reprodução
```

Evite registrar dados sensíveis desnecessariamente.

Crie uma página opcional:

```text
Configurações → Logs
```

---

# 27. Tratamento de falhas

A aplicação deverá lidar corretamente com:

- servidor DLNA offline
- servidor desaparecendo da rede
- timeout
- resposta XML inválida
- mídia removida
- URL inválida
- API externa indisponível
- limite de API
- FFmpeg inexistente
- vídeo incompatível
- conexão interrompida durante streaming

Nenhuma dessas situações deverá derrubar o servidor web inteiro.

---

# 28. Descoberta e atualização inteligente

Não faça uma varredura completa desnecessariamente.

Implemente:

```text
Primeira sincronização
        ↓
Scan completo

Próximas sincronizações
        ↓
Detectar alterações
        ↓
Atualizar somente o necessário
```

Caso o protocolo/servidor não permita detectar alterações de forma eficiente, faça uma nova enumeração, mas compare os resultados com o banco local.

---

# 29. Cache de imagens

Não dependa de buscar o pôster na API toda vez que abrir a biblioteca.

Baixe e armazene localmente:

```text
data/
├── database/
├── posters/
├── backdrops/
├── thumbnails/
└── cache/
```

Utilize nomes de arquivos baseados em IDs estáveis.

---

# 30. Segurança

Mesmo sendo uma aplicação doméstica:

- valide URLs vindas do DLNA;
- evite path traversal;
- não permita que o usuário forneça caminhos arbitrários para o FFmpeg;
- valide parâmetros HTTP;
- limite tamanho de requisições;
- evite execução arbitrária de comandos;
- sanitize nomes de arquivos;
- não exponha secrets no frontend.

O FFmpeg deverá ser executado usando argumentos estruturados, nunca concatenando entrada do usuário diretamente em um comando shell.

---

# 31. API REST

Crie uma API organizada.

Exemplo:

```text
GET    /api/servers
POST   /api/servers/discover
GET    /api/servers/:id
POST   /api/servers/:id/scan
DELETE /api/servers/:id

GET    /api/media
GET    /api/media/:id
GET    /api/media/:id/stream
GET    /api/media/:id/thumbnail

GET    /api/movies
GET    /api/series
GET    /api/anime

GET    /api/search?q=

GET    /api/jobs
GET    /api/jobs/:id

GET    /api/history
POST   /api/history
```

Documente a API.

---

# 32. Frontend

Escolha um framework moderno para o frontend.

Pode utilizar, por exemplo:

```text
React + TypeScript
```

ou outra alternativa adequada.

O frontend deverá ser separado logicamente do backend.

Organize componentes:

```text
components/
├── MediaCard
├── MediaGrid
├── VideoPlayer
├── SearchBar
├── Sidebar
├── ServerStatus
├── ProgressBar
└── EpisodeList
```

Páginas:

```text
Home
Movies
Series
Anime
Search
MediaDetails
Player
Servers
Settings
```

---

# 33. Backend

Escolha uma tecnologia adequada para implementar:

- HTTP server
- REST API
- DLNA
- SSDP
- jobs
- SQLite
- FFmpeg
- cache

A implementação deve ser modular.

Sugestão de módulos:

```text
backend/
├── api/
├── dlna/
├── discovery/
├── library/
├── metadata/
├── playback/
├── scanner/
├── database/
├── jobs/
├── cache/
└── config/
```

---

# 34. Testes

Crie testes automatizados para:

### DLNA

```text
SSDP discovery
Device description
ContentDirectory
Browse
Pagination
```

### Biblioteca

```text
Adicionar mídia
Atualizar mídia
Remover mídia
Detectar duplicatas
```

### Metadata

```text
Normalização
Busca
Matching
Confidence score
Cache
```

### Streaming

```text
HTTP Range
Seek
Stream interruption
Unsupported media
```

### API

Teste todos os endpoints importantes.

---

# 35. Docker

Opcionalmente forneça um:

```text
Dockerfile
docker-compose.yml
```

Mas a aplicação deverá também funcionar **diretamente no Linux**, sem Docker.

Caso Docker seja utilizado, certifique-se de que a descoberta SSDP/DLNA funcione corretamente na rede, documentando a necessidade de configurações como `network_mode: host` quando necessário.

---

# 36. Instalação nativa

Forneça uma maneira simples de instalar.

Idealmente:

```text
install.sh
```

ou um pacote adequado.

A instalação deverá:

1. Verificar dependências.
2. Instalar a aplicação.
3. Criar diretórios necessários.
4. Criar configuração padrão.
5. Configurar o serviço systemd.
6. Iniciar a aplicação.
7. Mostrar o endereço da interface web.

Exemplo final:

```text
✓ Aplicação instalada

Acesse:

http://localhost:8080
```

---

# 37. Primeiro acesso

Ao abrir a aplicação pela primeira vez:

```text
┌──────────────────────────────┐
│     ShelfCast            │
│                              │
│  Procurando servidores...    │
│                              │
│  🔎 3 servidores encontrados │
└──────────────────────────────┘
```

Depois:

```text
Servidores encontrados

☑ MiniDLNA
  192.168.1.50

☑ Media Server
  192.168.1.60

[Adicionar todos]
```

Após selecionar:

```text
Iniciando primeira sincronização...

2.431 mídias encontradas
```

---

# 38. Duplicatas

É possível que o mesmo filme exista em mais de um servidor.

Não crie necessariamente dois filmes na interface.

Modele:

```text
Movie
  ├── Source 1
  └── Source 2
```

Assim o usuário poderá escolher de qual servidor reproduzir.

Na página do filme:

```text
The Matrix

Fontes:

● Servidor Sala
  1080p H.264

● Servidor NAS
  4K HEVC

[Assistir]
```

---

# 39. Identificação de qualidade

Tente determinar automaticamente:

```text
4K
2160p
1080p
720p
480p
SD
```

A partir dos metadados DLNA ou do nome do arquivo.

Também mostre:

```text
HDR
SDR
HEVC
H.264
AV1
AAC
AC3
DTS
```

quando essas informações estiverem disponíveis.

---

# 40. Continuidade de reprodução

Implemente:

```text
Continuar assistindo
```

Exemplo:

```text
Breaking Bad

S02E03

▶ Continuar em 23:41
```

Para episódios, ao terminar:

```text
Episódio concluído

Próximo episódio:
S02E04

[Assistir próximo]
```

---

# 41. Dashboard

A página inicial deverá apresentar algo semelhante a:

```text
Olá!

Continue assistindo
────────────────────

[ Breaking Bad ] [ One Piece ] [ Matrix ]

Adicionados recentemente
─────────────────────────

[ Filme ] [ Filme ] [ Anime ] [ Série ]

Filmes
──────

[ ... ]

Séries
──────

[ ... ]
```

---

# 42. Performance

A aplicação deve ser capaz de lidar com uma biblioteca de pelo menos:

```text
10.000 mídias
```

sem tornar a interface lenta.

Utilize:

- paginação
- lazy loading
- índices SQL
- cache
- processamento assíncrono
- thumbnails otimizadas
- consultas eficientes

Não carregue toda a biblioteca no frontend.

---

# 43. Resultado esperado

Ao finalizar, o usuário deverá conseguir:

```text
1. Instalar a aplicação no Linux
2. Iniciar o serviço
3. Abrir http://localhost:8080
4. Encontrar automaticamente servidores DLNA
5. Selecionar um servidor
6. Fazer a aplicação escanear todo o conteúdo
7. Ver filmes, séries e animes organizados
8. Receber pôsteres e informações automaticamente
9. Pesquisar mídias
10. Abrir uma mídia
11. Reproduzir o vídeo no navegador
12. Pausar e continuar posteriormente
13. Continuar usando a aplicação enquanto ela sincroniza
```

---

# 44. Ordem obrigatória de implementação

Não tente implementar tudo simultaneamente.

Desenvolva em fases.

## Fase 1 — Fundação

- Criar projeto.
- Definir arquitetura.
- Configurar backend.
- Configurar frontend.
- Configurar SQLite.
- Criar configuração.
- Criar logging.

## Fase 2 — DLNA

- Implementar SSDP discovery.
- Detectar servidores.
- Obter device description.
- Encontrar ContentDirectory.
- Implementar Browse.
- Implementar paginação.

## Fase 3 — Biblioteca

- Criar modelos de mídia.
- Fazer scan recursivo.
- Persistir mídias.
- Detectar alterações.
- Criar jobs de sincronização.

## Fase 4 — Metadados

- Implementar MetadataProvider.
- Integrar TMDB.
- Integrar TVMaze.
- Avaliar integração com AniList/Jikan.
- Implementar matching.
- Implementar cache.

## Fase 5 — Interface

- Home.
- Biblioteca.
- Filmes.
- Séries.
- Animes.
- Pesquisa.
- Página de detalhes.

## Fase 6 — Player

- Implementar streaming.
- Implementar Range Requests.
- Implementar player HTML5.
- Implementar progresso.
- Implementar FFmpeg como fallback.

## Fase 7 — Background

- Criar jobs.
- Criar sincronização periódica.
- Criar serviço systemd.
- Implementar recuperação de falhas.

## Fase 8 — Refinamento

- Performance.
- Tratamento de erros.
- Responsividade.
- Atalhos de teclado.
- Logs.
- Testes.
- Documentação.

---

# 45. Requisitos importantes

Não faça uma implementação simplificada que apenas lista arquivos.

O objetivo é criar uma experiência semelhante a uma **biblioteca pessoal de streaming**, utilizando os servidores DLNA existentes como fonte dos arquivos.

A aplicação **não deve copiar todos os vídeos para o computador local**.

Os vídeos devem permanecer no servidor DLNA.

A aplicação deve armazenar localmente apenas:

```text
Metadados
Banco de dados
Cache
Pôsteres
Thumbnails
Informações de reprodução
```

A reprodução deverá ocorrer através da rede.

---

# 46. Entregáveis

Ao terminar a implementação, forneça:

```text
Código-fonte completo
README.md
.env.example
Dockerfile
docker-compose.yml
systemd service
Scripts de instalação
Documentação da API
Testes
```

O README deverá explicar:

1. Requisitos.
2. Instalação.
3. Configuração.
4. Como iniciar.
5. Como acessar pelo navegador.
6. Como configurar APIs de metadados.
7. Como funciona a descoberta DLNA.
8. Como configurar FFmpeg.
9. Como executar como serviço.
10. Como solucionar problemas comuns.

---

# 47. Critério de conclusão

Considere o projeto concluído somente quando for possível realizar este fluxo de ponta a ponta:

```text
Linux
  ↓
Iniciar aplicação
  ↓
Descobrir servidor DLNA automaticamente
  ↓
Conectar ao servidor
  ↓
Percorrer todas as pastas
  ↓
Encontrar vídeos
  ↓
Salvar biblioteca
  ↓
Identificar filmes/séries/animes
  ↓
Buscar metadados
  ↓
Mostrar pôsteres e informações
  ↓
Usuário abre uma mídia
  ↓
Player inicia
  ↓
Vídeo é transmitido diretamente do servidor DLNA
  ↓
Usuário consegue pausar/avançar/continuar
```

**Importante:** implemente uma fase por vez. Ao terminar cada fase, execute os testes correspondentes antes de avançar para a próxima. Não considere uma funcionalidade concluída apenas porque o código foi escrito; valide seu funcionamento real.