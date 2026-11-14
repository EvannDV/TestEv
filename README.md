# JARVIS — écran de bord

Un HUD plein écran (`web/index.html`) alimenté en temps réel par un petit serveur
Python (`server.py`) qui lit la voiture.

```
voiture ──(OBD-II ou CAN)──> server.py ──(WebSocket)──> navigateur plein écran
```

## Démarrage rapide (sans voiture)

```bash
pip install aiohttp
```

```bash
python3 server.py --source sim
```

Ouvre `http://localhost:8080` puis touche l'écran. Tu peux aussi ouvrir
`web/index.html` directement : il passe en mode DÉMO tout seul.

## Sources de données

| Source | Matériel | Commande |
|---|---|---|
| `sim` | aucun | `python3 server.py --source sim` |
| `obd` | dongle ELM327 (USB/Bluetooth) sur la prise OBD | `python3 server.py --source obd --port /dev/rfcomm0` |
| `can` | interface CAN (MCP2515, CANable, PiCAN…) + fichier DBC de ta voiture | `python3 server.py --source can --channel can0 --dbc ma_voiture.dbc` |

- **obd** : marche sur toute voiture essence ≥ 2001 / diesel ≥ 2004, sans rien connaître
  du véhicule. Rafraîchissement plus lent (quelques valeurs par seconde).
- **can** : rapide et riche (rapport engagé, portes, etc.) mais les trames sont propres
  à chaque constructeur. Il faut un fichier DBC pour ton modèle (voir le dépôt
  `commaai/opendbc`), puis faire correspondre les noms de signaux dans `can_map.json`
  (`"NomDuSignalDBC": "champ"`). Champs disponibles : `speed rpm coolant fuel voltage
  throttle intake load gear`.

Le serveur n'émet jamais sur le bus. Pour le garantir au niveau matériel :

```bash
sudo ip link set can0 up type can bitrate 500000 listen-only on
```

## Sur l'écran

- Toucher au démarrage : active la voix (obligatoire côté navigateur) et le plein écran.
- Toucher la jauge centrale : rapport d'état vocal.
- `VOIX ON/OFF` en bas à droite.
- Alertes vocales et visuelles : surchauffe, carburant bas, batterie faible, zone rouge,
  perte de liaison.
- Réglages par l'URL : `?vmax=240&rpmmax=7000&redline=6000` (diesel : `rpmmax=5500&redline=4500`).

## Installation dans la voiture

**Raspberry Pi + écran** : lancer le serveur au boot puis Chromium en kiosque :

```bash
chromium-browser --kiosk --autoplay-policy=no-user-gesture-required "http://localhost:8080/?autostart"
```

**Autoradio Android** : le serveur tourne sur un Pi (ou dans Termux sur l'autoradio avec
un ELM327 Bluetooth), et l'autoradio ouvre `http://<ip>:8080` dans un navigateur kiosque
(ex. Fully Kiosk Browser).

## Appli Android (`jarvis-hud.apk`)

Pour autoradio Android ou boîtier « CarPlay AI Box » (CarPlay lui-même, côté iPhone,
n'exécute pas d'APK). L'appli embarque le HUD et lit la voiture toute seule via un
dongle **OBD-II ELM327 Bluetooth classique** (pas BLE, pas Wi-Fi) : pas besoin du
serveur Python.

1. Branche le dongle sur la prise OBD, contact mis, et appaire-le dans les réglages
   Bluetooth d'Android (code 1234 ou 0000).
2. Installe `jarvis-hud.apk` (autoriser les sources inconnues).
3. Au premier lancement, choisis le dongle dans la liste, ou « Mode démo ».
   Pour en changer : touche l'indicateur de liaison en haut à droite.

La voix passe par la synthèse vocale d'Android : il faut une voix française installée.

Reconstruire : `android/build.sh` (JDK + SDK Android build-tools 34). Garde
`android/jarvis.keystore` : la même clé est nécessaire pour installer une mise à jour.
