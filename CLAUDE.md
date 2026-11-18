# JARVIS HUD — contexte pour reprendre le projet

Écran de bord « type Jarvis » pour la voiture de l'utilisateur. Il parle français, n'est pas
développeur : réponses simples, étapes numérotées, et il teste sur la voiture puis envoie des photos.

## Objectif

Faire tourner sur l'autoradio Android l'interface de `EvannDV/jarvis-giulietta`, **à
l'identique**, avec les données moteur lues par l'**OBDLink CX (Bluetooth basse
consommation)**, comme l'appli d'origine. Le 18 nov. 2026, l'utilisateur a demandé
d'**abandonner le bus CAN** (voir « Archive CAN » en bas) et de reprendre l'OBD.

## Matériel (identifié par photos)

- Autoradio **TopWay** (applis système `com.tw.*`, plus `com.dofun.*`), puce Spreadtrum
  SC7731e, Android 8.1 (API 27), écran paysage environ 1024×600.
- WebView ancien : pas de CSS `min()`, `aspect-ratio`, `inset`, ni `gap` en flexbox.
  Ne pas les utiliser dans `web/index.html`. Processeur faible : éviter les `filter` CSS.
- Voiture : **Alfa Romeo Giulietta 2.0 JTDM** (140 ch, boîte 6).

## Dépôt source

`EvannDV/jarvis-giulietta` (appli Capacitor 8, une page `src/index.html` : modes DNA, carte 3D
MapLibre, Gemini, mécano, perf, garage, musique...). **Ne pas le modifier** : c'est la version
OBD validée sur la voiture (sur une tablette). Source de données isolée : `source.step(dt)`
renvoie `{speed, rpm, gear, boost, coolant, oil, batt, soot, regen, regens, load, lph, ext,
accel, fuel}`. Plugins natifs d'origine : `BluetoothLe`, `TextToSpeech`, `CapacitorHttp`,
`JarvisMedia`, `JarvisNotif`, `JarvisUpdate`, `JarvisVoice` (non repris : la page tourne en
mode « web », `NATIVE` reste faux).

## Contenu du dépôt

- `web/index.html` : le HUD (une seule page, sans dépendance). Sources de données :
  WebSocket (`server.py`), appli Android (`window.Android` + `onCar(json)`), ou démo (`?demo`).
- `server.py` : serveur Python optionnel (simulateur, OBD ELM327, CAN + DBC). Hors sujet
  pour l'autoradio, gardé pour un Raspberry Pi.
- `android/` : appli Java sans Gradle. `MainActivity` (WebView, voix, micro, menu),
  `BleBridge` + `BleGattCb` + `BleScanCb` (Bluetooth de l'OBDLink), `Updater`, `SrListener`.
- `web/index.html` + `server.py` : premier HUD simple, plus utilisé par l'APK.
- `jarvis-hud.apk` : APK construit, servi par
  `https://github.com/EvannDV/TestEv/raw/main/jarvis-hud.apk`. `index.html` à la racine est
  une page de téléchargement pour GitHub Pages (à activer par l'utilisateur dans Settings → Pages).

## Construire l'APK

Il faut un JDK et le SDK Android (`build-tools;34.0.0`, `platforms;android-34`) dans
`/opt/android-sdk` (ou `ANDROID_HOME`), installables avec `sdkmanager` depuis
`dl.google.com`. Puis `android/build.sh`. À chaque version : monter `VERSION_CODE` /
`VERSION_NAME` en tête de `build.sh`, puis commit + push sur `main`.

- Lancer avec `JAVA_TOOL_OPTIONS=` vide si la variable pollue la sortie.
- Bug de `d8` 34 avec javac 21 : **pas de classes internes ni anonymes** (plantage
  « String.length() ... null »). Utiliser des lambdas et des classes de premier niveau.
- La clé de signature (`android/jarvis.keystore`) n'est volontairement pas dans le dépôt
  (dépôt public). Une nouvelle session en génère une autre : l'utilisateur doit alors
  **désinstaller l'appli avant d'installer** la nouvelle version.

## Portage Giulietta (v2.0, 16 nov. 2026)

L'APK embarque maintenant l'interface de `jarvis-giulietta`, convertie par `tools/port.mjs` :

- `giulietta/src/index.html` : copie **non modifiée** de `jarvis-giulietta/src/index.html`
  (commit 3a76c6e). Pour reprendre une version plus récente : recopier le fichier, relancer
  `node tools/port.mjs` ; les retouches sont des `patch()` qui échouent si le motif a changé.
- `tools/css.mjs` : `inset` -> top/right/bottom/left ; `gap` flex -> marges (`>*+*`, en
  `!important`) ; `gap` grid -> `grid-gap` ; `clamp/min/max` -> variables `--jxN` calculées
  en px au lancement ; `place-items`, `padding-block` développés.
- `tools/shim.js` : polyfills, voix (`speechSynthesis` -> `Android.say`), **carte 2D en
  tuiles images Esri/OSM** exposée comme `window.maplibregl` (plus de MapLibre ni de WebGL),
  rapports d'aspect, bandeau rouge d'erreurs JS.
- OBD (v3.0) : le code OBD d'origine (`ObdSource` + `WebBleLink`) est utilisé **tel quel** ;
  `shim.js` fournit `navigator.bluetooth` (requestDevice, gatt.connect, getPrimaryService,
  getCharacteristics, startNotifications, writeValue...) par `Android.ble(méthode, n°, args)`
  -> `BleBridge.java`, réponses par `__bleDone`, notifications et coupures par `__bleEvent`.
  Retouche `port.mjs` : reconnexion automatique au dernier adaptateur au lancement
  (`navigator.bluetooth.knownDevice`), comme l'appli Android d'origine.
- Carte : tuiles **Esri** Dark Gray (fond + noms de rues, sans clé, zoom max 16 puis
  agrandi), repli automatique sur **OpenStreetMap** si Esri ne répond pas. CARTO affichait
  « API key » sur l'autoradio.
- Menu Android : **appui long sur « J.A.R.V.I.S »** en haut à gauche (mises à jour,
  Diagnostic, Recharger). Le badge OBD sert à connecter l'adaptateur, comme à l'origine.
- Babel cible Chrome 58 ; `acorn` vérifie qu'aucune syntaxe récente ne subsiste.
- `giulietta/dist/index.html` : résultat, commité, copié dans l'APK par `android/build.sh`.
- Côté Android : page servie sous `https://jarvis.app/` (interception), GPS, voix, micro.
- La page tourne en mode « web » (pas de Capacitor) : pas de musique des autres applis,
  pas de lecture des messages, pas d'écoute vocale ; les flux
  d'actualité RSS sont bloqués par CORS.

Vérifié : dans Chromium récent uniquement (aucune erreur JS, mise en page à quelques px de
l'original sur les 5 pages × 3 modes DNA en 1024×600, carte avec tuiles de test, OBDLink
simulé : connexion, valeurs, coupure et reprise, reconnexion au redémarrage). **Jamais exécuté sur un vieux moteur** : le téléchargement d'un ancien Chromium
a été refusé dans la session. Fluidité sur le SC7731e inconnue.

Comparer original et portage : `node tools/port.mjs --temoin /chemin/orig.html`, puis ouvrir
`dist/index.html?apercu` (simulateur) à côté.

## Un seul style, allégé (v3.1, 18 nov. 2026)

À la demande de l'utilisateur : **un seul style** (Natural, noir et champagne), très optimisé.
Retouches dans `tools/port.mjs` :
- styles Sport (D) et Pluie (A) retirés du CSS (règles `[data-dna="D|A"]`, `.modefx`), sélecteur
  DNA masqué, `setDna` force N (Jarvis répond qu'il n'y a qu'un style), `modeTransition` vide ;
- fond animé plein écran (`fx.draw`, deux toiles redessinées à chaque image) supprimé ;
- `fitCanvas` garde la taille des toiles (la mesurer à chaque image forçait un recalcul de page) ;
- voiture 3D (page Moteur) : vue fixe, redessinée une fois par seconde ;
- `backdrop-filter` et animations décoratives infinies retirés ; `contain: layout style` sur
  `.panel`, `.top`, `.controls` ;
- carte 2D : itinéraire dessiné sur une toile de la taille de l'écran (l'ancienne toile en
  coordonnées carte faisait jusqu'à 2 200 px de côté et coûtait très cher à l'affichage).
Mesure (Chromium, processeur ralenti 6×, mode appli avec « mode démo »), ms par image :
Conduite 32 -> 10, Nav 42 -> 7, Moteur 82 -> 9, Perf 24 -> 7, Garage 17 -> 2.

## Banc de puissance (v3.1) : `tools/dyno.js`

Remplace le banc d'origine (`patchRange` de `const dyno =` à `function drawDyno`). Défauts de
l'original : départ seulement entre 1 000 et 2 200 tr/min avec charge OBD > 80 % (tirage
souvent jamais détecté), mesures datées à l'affichage et lissées (retard), vitesse en km/h
entiers. Nouveau :
- mesures datées au milieu question/réponse (`ObdSource.read`), régime seul (plus 0D une fois
  sur trois) pendant le banc (`ObdSource.loop`) ;
- départ : couple nécessaire à la montée de régime >= 55 % du couple d'origine (tout rapport),
  début de courbe coupé tant que < 60 % ; fin : régime qui retombe, plafonne, embrayage
  (rapport qui varie de 8 %), 4 900 tr/min, 30 s ;
- v et a tirés du régime ÷ rapport mesuré ; régression quadratique locale (±0,65 s, 9 points
  mini) ; lissage 1-2-1 entre paliers de 250 tr/min avant de prendre les pics ;
- physique : masses tournantes λ = 1,04 + 0,0025·i², densité de l'air OBD (33, 46),
  rendement de transmission 0,90 ;
- calibration en tâche de fond du compteur OBD par la vitesse GPS (roulage stable > 30 km/h),
  `store 'dynoSpeedCal'`, utilisée dès 10 mesures.
Test (faux OBDLink piloté par une voiture simulée, couple d'origine = 140 ch / 320 Nm) :
puissance max à ±1,5 % sur 3e, 4e, départ à 2 200, montée douce, adaptateur lent ; compteur
faux de 3 % : +5 % sans GPS, -0,7 % calé GPS. Erreurs réelles non simulées : pente, vent,
masse (passagers, carburant), pertes réelles de transmission.

## Nouveau design (v3.2, 18 nov. 2026)

À la demande de l'utilisateur : design refait, plus joli, et banc plus clair.
- `tools/theme.css` (ajouté à la fin du CSS, avant conversion) : thème Jarvis cyan glacier
  sur anthracite (variables `:root[data-dna="N"]`), panneaux arrondis, onglets en pilules,
  boutons, puces d'état, console, fenêtre holographique. Pas de flou ni de filtre.
- `tools/dials.js` remplace `gtDial`/`gtUpdate` : arc lumineux (`stroke-dasharray` sur
  `pathLength=1000`), grand chiffre au centre (rapport sur le compte-tours, vitesse sur
  l'autre), régime en sous-titre, zone rouge, aiguille courte sur le bord.
- Banc : `tools/dyno.html` (balisage) + `tools/dynoui.js` (`drawDyno`, `renderDyno`). Page
  Perf pleine largeur en mode banc (G-mètre masqué et plus dessiné). À gauche : courbes avec
  légende, surface sous la puissance, pics étiquetés, origine en pointillés, mesure
  précédente en pâle. À droite : puce d'état, pendant la mesure régime / rapport / vitesse,
  barre 1 500 -> 4 500 et 4 étapes qui se cochent ; après : puissance et couple max, % de
  l'origine avec verdict, écart avec la mesure précédente, conditions (rapport, plage, air,
  nombre de mesures, compteur calé GPS ou non, fiabilité), historique (`store 'dynoHist'`).
  Pendant la mesure seul un trait HTML (curseur) bouge : la toile n'est redessinée qu'à la fin.
Coût par image inchangé (environ 10 ms sur la page Conduite, processeur ralenti 6×).

## Mises à jour intégrées (v2.1)

`Updater.java` lit `version.json` (généré par `android/build.sh` à partir de `VERSION_CODE` /
`VERSION_NAME`) sur `raw.githubusercontent.com`, 15 s après le lancement puis toutes les 6 h,
et depuis le menu natif. Si le code est supérieur à celui installé : dialogue, téléchargement
de `jarvis-hud.apk`, installation par `PackageInstaller` (Android demande confirmation).
Pour publier une version : monter `VERSION_CODE` et `VERSION_NAME`, `build.sh`, commit, push.
**Ne marche que si l'APK est signé avec la même clé** : la clé n'existe que dans la session
qui l'a créée (empreinte SHA-256 `75a2d20d…12e9c6`). Jamais testé sur l'autoradio.

## Voix (v2.3)

Le WebView expose un `speechSynthesis` muet : `shim.js` le remplace **toujours** dans l'appli
(`Android.say`). Le micro passe par `SpeechRecognizer` d'Android (`SrListener.java`, exposé en
`webkitSpeechRecognition`), ce qui demande l'appli Google ou un autre service de
reconnaissance sur l'autoradio. Le Diagnostic affiche les lignes VOIX et MICRO.

## Où on en est

1. Fait : v3.0 = interface Giulietta + OBD Bluetooth + carte Esri/OSM + voix et micro Android
   + mises à jour intégrées. Le CAN est retiré de l'appli.
2. v3.0 confirmée par l'utilisateur sur l'autoradio (« ça marche »).
3. **En attente de l'utilisateur** : essai de la v3.2 (nouveau design, banc réel, fluidité).

## Règles

- Ne jamais présenter comme testé ce qui ne l'a pas été sur l'autoradio.
- Pas de données personnelles dans le dépôt (il est public).

## Archive CAN (abandonné le 18 nov. 2026, à la demande de l'utilisateur)

Les applis système reçoivent les données via la classe cachée `android.tw.john.TWUtil`
(accessible par réflexion). API confirmée sur l'appareil :

- `TWUtil()`, `TWUtil(int)`, `int open(short[])`, `int open(short[], int)`, `start()`, `stop()`,
  `close()`, `addHandler(String, Handler)`, `removeHandler(String)`,
  `write(int[, int[, int[, Object[, Object]]]])`.
- On s'abonne à une liste d'identifiants ; les messages arrivent dans le `Handler`
  (`what` = identifiant, `arg1`, `arg2`, `obj`).
- `com.tw.car` (appli CAN) s'abonne à `010A 0501 0508 010B 0201 020C`.
  `com.tw.carinfoservice` à `0501 0506..050E 0511 0512 9F1C ...`.
- Messages vus (capture courte, moteur peut-être arrêté) :
  `0501` arg1=38 arg2=2 obj=`00 00` (3 changements), `0506` obj=`00 00 1C 02`, `0505`, `0202`.
- Sur `0501` : `arg1` = type de trame du boîtier CAN, `arg2` = longueur, `obj` = `byte[]`.

Capture du 18 nov. 2026 (écoute v1.4+, état du moteur inconnu, aucune action signalée) :
chaque trame n'est arrivée **qu'une fois** (« recus 8 » = 8 abonnements en double, corrigé
en v2.2), aucune n'a changé : c'est un envoi au démarrage, pas un flux en direct.

```
0202        6 0                     0204   0 2570 puis 1 2570
0501 t13    FF FF 01 0F 03 12 42 FF FF FF
0501 t14    00 36 26 00 05 21 03 1C 00 03
0501 t15    00 33 10 02 F3 44 DA 1F 01 DA
0501 t26    00 00
0501 t48    00 00 FF FF FF FF 00 00 ... 00
0501 t71    B9 F0 BF 00          (lecture photo incertaine)
0501 t72    00 00 D5 55 57 07 13 01
0501 t76    00 24 08 00
0501 t79    00 00 00 00 00 00 00 00
0501 t94    05
0501 tC1    A9 A0 02
0501 tC2    1A 08 11 04 33 00 00 00 00 00   (hypothèse : date/heure, 1A = 26 ; 08 ou 0B ?)
0501 tFF    C8
0505 t00    00 puis 40 puis 00
0506 t00    00 00 1C 02
0507 t00    FE FE FE FE 08 FE 09 FE FE 08   (hypothèse : radars, FE = rien)
```

Capture n°2 (18 nov., écoute v3, moteur allumé à 00:05, « 2000 TR/MIN » à 00:17, « PORTE »
à 00:30 ; volant et rouler non faits) :
- Rien ne réagit au régime : **pas de régime en flux**. Vitesse pas encore testée (pas roulé).
- `0505 t00` : 00 -> 40 -> 00 à 00:28-00:29, juste avant « PORTE » : sans doute une porte
  (0x40 = ouverte). À confirmer.
- Trois compteurs montent lentement ensemble (environ 1 toutes les 30 s, moteur froid) :
  `t13` octet 4 (0F à la 1re capture, puis 15, 16, 17), `t14` octet 8 (1C, puis 21, 22),
  `t15` octet 8 (1F, puis 24, 25 ; toujours t14 + 3). Hypothèse : températures en hausse
  (eau, huile ?), en °C directs. À vérifier moteur chaud (devrait se stabiliser vers 80-90).
- `tC2` : 1A 08 11 04 39 (04 33 à la 1re capture) : sans doute la date et l'heure.

L'hypothèse « protocole Raise VW » faite avant de connaître la voiture est abandonnée :
c'est une Alfa. Le protocole du boîtier reste à identifier à partir des trames.

