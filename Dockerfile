# Node.js (sem dependências externas de runtime)
FROM node:22-slim

# FFmpeg para transcodificação
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public
COPY .env.example .env.example

RUN mkdir -p data/{posters,backdrops,thumbnails,cache,logs}

# A descoberta SSDP/DLNA exige acesso à rede da LAN (multicast + resposta unicast).
# Por isso o container deve rodar com network_mode: host.
EXPOSE 8080

ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["node", "src/index.js"]
