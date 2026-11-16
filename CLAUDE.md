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
- Voiture : **inconnue**, demandée plusieurs fois sans réponse. Le tableau de bord ressemble
  à un groupe VW. À redemander (marque, modèle, année).

## Contenu du dépôt

- `web/index.html` : le HUD (une seule page, sans dépendance). Sources de données :
  WebSocket (`server.py`), appli Android (`window.Android` + `onCar(json)`), ou démo (`?demo`).
- `server.py` : serveur Python optionnel (simulateur, OBD ELM327, CAN + DBC). Hors sujet
  pour l'autoradio, gardé pour un Raspberry Pi.
- `android/` : appli Java sans Gradle. `MainActivity` (WebView + voix TTS + menu),
  `ElmReader` (OBD Bluetooth, non testé en vrai), `SniffActivity` (écoute CAN TopWay).
- `jarvis-hud.apk` : APK construit, servi par
  `https://github.com/EvannDV/TestEv/raw/main/jarvis-hud.apk`. `index.html` à la racine est
  une page de téléchargement pour GitHub Pages (à activer par l'utilisateur dans Settings → Pages).

## Construire l'APK

Il faut un JDK et le SDK Android (`build-tools;34.0.0`, `platforms;android-34`) dans
`/opt/android-sdk` (ou `ANDROID_HOME`), installables avec `sdkmanager` depuis
`dl.google.com`. Puis `android/build.sh`. À chaque version : monter `--version-code` /
`--version-name` dans `build.sh` et le numéro dans `index.html`, puis commit + push sur `main`.

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

**Hypothèse non confirmée** : boîtier au protocole « Raise » du groupe VW. Type 0x26 = angle
volant, 0x16 = vitesse, 0x24 = portes, 0x41 = infos véhicule (sous-type 2 : régime, vitesse,
tension, température extérieure, kilométrage, carburant), cette dernière envoyée seulement
sur demande. Ce décodage vient de mémoire, à valider sur de vraies trames.

## Où on en est

1. Fait : HUD, APK, affichage corrigé pour le vieux WebView (v1.3), écoute CAN v2 (v1.4)
   triée par type de trame avec historique et décodage provisoire.
2. **En attente de l'utilisateur** : photos du tableau d'écoute v1.4, moteur tournant
   (tourner le volant, ouvrir une porte, 2000 tr/min, rouler), et le modèle de la voiture.
3. Ensuite : identifier les trames vitesse/régime/etc., écrire un `TwReader` (même rôle
   qu'`ElmReader`, pousse le JSON vers `onCar`) et en faire la source par défaut.
4. Si la trame d'infos véhicule n'arrive que sur demande : trouver le format de `write`
   utilisé par `com.tw.car` avant d'envoyer quoi que ce soit. **Ne rien envoyer à l'aveugle
   sur le bus** ; l'appli est en lecture seule jusqu'ici.

## Règles

- Ne jamais présenter comme testé ce qui ne l'a pas été sur l'autoradio.
- Pas de données personnelles dans le dépôt (il est public).
