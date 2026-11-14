#!/usr/bin/env bash
# Construit jarvis-hud.apk sans Gradle. Requiert un JDK et le SDK Android
# (build-tools 34 + platforms/android-34) ; ANDROID_HOME pointe dessus.
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"
OUT=build
KS="${KEYSTORE:-jarvis.keystore}"   # a conserver : il faut la meme cle pour mettre a jour l'appli

rm -rf "$OUT" && mkdir -p "$OUT"/{gen,obj,dex,assets}
cp ../web/index.html "$OUT/assets/"

"$BT/aapt2" compile --dir res -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest AndroidManifest.xml -A "$OUT/assets" \
  --java "$OUT/gen" --min-sdk-version 21 --target-sdk-version 33 \
  --version-code 4 --version-name 1.3 "$OUT/res.zip"
javac -nowarn -source 8 -target 8 -cp "$JAR" -d "$OUT/obj" $(find src "$OUT/gen" -name '*.java') 2>&1 | grep -v '^warning\|^Note\|^[0-9]* warning' || true
"$BT/d8" --lib "$JAR" --min-api 21 --output "$OUT/dex" $(find "$OUT/obj" -name '*.class')
(cd "$OUT/dex" && zip -q -j ../base.apk classes.dex)
"$BT/zipalign" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass jarvis1 -keypass jarvis1 -alias jarvis \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Jarvis HUD" 2>/dev/null
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:jarvis1 --key-pass pass:jarvis1 --out ../jarvis-hud.apk "$OUT/aligned.apk"
rm -f ../jarvis-hud.apk.idsig
echo "OK -> $(cd .. && pwd)/jarvis-hud.apk"
