# JARVIS HUD — contexte pour reprendre le projet

Écran de bord « type Jarvis » pour la voiture de l'utilisateur. Il parle français, n'est pas
développeur : réponses simples, étapes numérotées, et il teste sur la voiture puis envoie des photos.

## Objectif

Afficher vitesse, régime, températures, carburant, batterie sur l'autoradio Android de la
voiture, en lisant les données **par le bus CAN de l'autoradio**, sans dongle OBD.

## Matériel (identifié par photos)

- Autoradio **TopWay** (applis système `com.tw.*`, plus `com.dofun.*`), puce Spreadtrum
  SC7731e, Android 8.1 (API 27), écran paysage environ 1024×600.
- WebView ancien : pas de CSS `min()`, `aspect-ratio`, `inset`, ni `gap` en flexbox.
  Ne pas les utiliser dans `web/index.html`. Processeur faible : éviter les `filter` CSS.
- Voiture : **Alfa Romeo Giulietta 2.0 JTDM** (140 ch, boîte 6).

## Demande en cours (16 nov. 2026)

Reprendre **à l'identique** l'interface du dépôt `EvannDV/jarvis-giulietta` (appli Capacitor 8,
une page `src/index.html` de 343 Ko : modes DNA, carte 3D MapLibre, Gemini, mécano, perf,
garage, musique...) mais alimentée par le CAN du TopWay au lieu de l'OBD Bluetooth.
Ne pas modifier `jarvis-giulietta` : c'est la version OBD validée sur la voiture.

Points clés de ce dépôt source :
- Source de données isolée : `source.step(dt)` renvoie `{speed, rpm, gear, boost, coolant, oil,
  batt, soot, regen, regens, load, lph, ext, accel, fuel}`. Il suffit d'ajouter une `CanSource`.
- Plugins natifs appelés : `BluetoothLe`, `TextToSpeech`, `CapacitorHttp`, `JarvisMedia`,
  `JarvisNotif`, `JarvisUpdate`, `JarvisVoice`.
- Obstacle 1 : la page utilise `??`, `?.`, et en CSS `gap` flex (103), `min/max/clamp`,
  `inset`, `aspect-ratio`, `backdrop-filter`. Le WebView de l'autoradio est antérieur à
  Chrome 79 : il faut transpiler le JS (Babel) et réécrire le CSS, selon la version exacte
  (affichée en tête du « Diagnostic de l'écran » depuis la v1.5, avec le support WebGL).
- Obstacle 2 : le boîtier CAN ne donnera probablement pas turbo, FAP, huile, conso, codes
  défaut. Ces valeurs resteront à NONE sans OBD. À confirmer par la capture.

## Contenu du dépôt

- `web/index.html` : le HUD (une seule page, sans dépendance). Sources de données :
  WebSocket (`server.py`), appli Android (`window.Android` + `onCar(json)`), ou démo (`?demo`).
- `server.py` : serveur Python optionnel (simulateur, OBD ELM327, CAN + DBC). Hors sujet
  pour l'autoradio, gardé pour un Raspberry Pi.
- `android/` : appli Java sans Gradle. `MainActivity` (WebView + voix TTS + menu),
  `TwBus` (abonnement CAN TopWay), `SniffActivity` (écoute CAN détaillée).
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

## Ce qu'on sait du CAN sur cet autoradio

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

L'hypothèse « protocole Raise VW » faite avant de connaître la voiture est abandonnée :
c'est une Alfa. Le protocole du boîtier reste à identifier à partir des trames.

## Portage Giulietta (v2.0, 16 nov. 2026)

L'APK embarque maintenant l'interface de `jarvis-giulietta`, convertie par `tools/port.mjs` :

- `giulietta/src/index.html` : copie **non modifiée** de `jarvis-giulietta/src/index.html`
  (commit 3a76c6e). Pour reprendre une version plus récente : recopier le fichier, relancer
  `node tools/port.mjs` ; les retouches sont des `patch()` qui échouent si le motif a changé.
- `tools/css.mjs` : `inset` -> top/right/bottom/left ; `gap` flex -> marges (`>*+*`, en
  `!important`) ; `gap` grid -> `grid-gap` ; `clamp/min/max` -> variables `--jxN` calculées
  en px au lancement ; `place-items`, `padding-block` développés.
- `tools/shim.js` : polyfills, voix (`speechSynthesis` -> `Android.say`), **carte 2D en
  tuiles images CARTO** exposée comme `window.maplibregl` (plus de MapLibre ni de WebGL),
  rapports d'aspect, bandeau rouge d'erreurs JS.
- `tools/cansource.js` : `CanSource extends ObdSource`, alimentée par
  `onCanFrame(what, type, hex)` (trames brutes envoyées par `TwBus.java`) et la table
  `CAN_DECODERS`, **vide pour l'instant**. Tout reste à NONE tant qu'elle est vide.
- Babel cible Chrome 58 ; `acorn` vérifie qu'aucune syntaxe récente ne subsiste.
- `giulietta/dist/index.html` : résultat, commité, copié dans l'APK par `android/build.sh`.
- Côté Android : page servie sous `https://jarvis.app/` (interception), GPS, TTS, menu
  natif (toucher le badge « CAN » en haut à gauche) : Écoute CAN, Diagnostic, Recharger.
- La page tourne en mode « web » (pas de Capacitor) : pas de musique des autres applis,
  pas de lecture des messages, pas d'écoute vocale ; les flux
  d'actualité RSS sont bloqués par CORS.

Vérifié : dans Chromium récent uniquement (aucune erreur JS, mise en page à quelques px de
l'original sur les 5 pages × 3 modes DNA en 1024×600, carte avec tuiles de test, trames CAN
simulées). **Jamais exécuté sur un vieux moteur** : le téléchargement d'un ancien Chromium
a été refusé dans la session. Fluidité sur le SC7731e inconnue.

Comparer original et portage : `node tools/port.mjs --temoin /chemin/orig.html`, puis ouvrir
`dist/index.html?apercu` (simulateur) à côté.

## Mises à jour intégrées (v2.1)

`Updater.java` lit `version.json` (généré par `android/build.sh` à partir de `VERSION_CODE` /
`VERSION_NAME`) sur `raw.githubusercontent.com`, 15 s après le lancement puis toutes les 6 h,
et depuis le menu natif. Si le code est supérieur à celui installé : dialogue, téléchargement
de `jarvis-hud.apk`, installation par `PackageInstaller` (Android demande confirmation).
Pour publier une version : monter `VERSION_CODE` et `VERSION_NAME`, `build.sh`, commit, push.
**Ne marche que si l'APK est signé avec la même clé** : la clé n'existe que dans la session
qui l'a créée (empreinte SHA-256 `75a2d20d…12e9c6`). Jamais testé sur l'autoradio.

## Où on en est

1. Fait : portage v2.0 ci-dessus, poussé sur `main`.
2. **En attente de l'utilisateur** : photo de la v2.0 sur l'autoradio (et du bandeau rouge
   ou du Diagnostic s'il y a des erreurs) ; photos de l'« Écoute CAN » moteur tournant
   (volant, porte, 2000 tr/min, rouler).
3. Ensuite : remplir `CAN_DECODERS` d'après les trames, corriger l'affichage d'après les photos.
4. Si une trame n'arrive que sur demande : trouver le format de `write` utilisé par
   `com.tw.car` avant d'envoyer quoi que ce soit. **Ne rien envoyer à l'aveugle sur le bus.**

## Règles

- Ne jamais présenter comme testé ce qui ne l'a pas été sur l'autoradio.
- Pas de données personnelles dans le dépôt (il est public).
