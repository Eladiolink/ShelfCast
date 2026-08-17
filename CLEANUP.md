# Limpeza da instalação antiga (modo /opt)

A instalação atual é por usuário (`~/.var/shelfcast`, sem sudo). Estes comandos removem os resquícios da instalação antiga em todo o sistema. Rode com `sudo`.

## ShelfCast (/opt/shelfcast)

```bash
sudo systemctl disable --now shelfcast
sudo rm -f /etc/systemd/system/shelfcast.service /var/log/shelfcast.log
sudo systemctl daemon-reload
sudo rm -rf /opt/shelfcast
sudo rm -f /usr/local/bin/shelfcast
sudo rm -f /usr/share/applications/shelfcast.desktop
sudo rm -f /usr/share/icons/hicolor/256x256/apps/shelfcast.png
```

## Versão antiga do app (media-library)

```bash
sudo systemctl disable --now media-library 2>/dev/null
sudo rm -f /etc/systemd/system/media-library.service /var/log/media-library.log
sudo rm -rf /opt/media-library
sudo rm -f /usr/local/bin/media-library /usr/share/applications/media-library.desktop
```

> **Atenção:** `/opt/shelfcast/data` e `/opt/media-library/data` contêm biblioteca/cache. A instalação nova em `~/.var/shelfcast` já migra esses dados ao rodar o instalador com sudo — apague-os apenas se confirmar que os dados já estão em `~/.var/shelfcast/data`.