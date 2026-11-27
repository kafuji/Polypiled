import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { replaceOnce } from "./runtime-patch.mjs";
import { questAppVersion } from "./app-version.mjs";

export const questPackageId = "io.github.kafuji.polypiled.quest";
export const questAppName = "Polypiled";

/** Shipping identity is independent of Gradle's debug/release build type. */
export function patchIdentity(checkout, version = questAppVersion()) {
  const buildPath = path.join(checkout, "app/build.gradle");
  let build = readFileSync(buildPath, "utf8").replaceAll("\r\n", "\n")
    // Checkouts prepared before the rename still carry the NetHack 3D identity.
    .replaceAll("com.nethack3d.quest.webxrproof", questPackageId)
    .replaceAll("com.nethack3d.quest.vr", questPackageId)
    .replaceAll("NetHack 3D WebXR Proof", questAppName)
    .replaceAll("NetHack 3D VR Auto", questAppName);
  build = build.replaceAll("NetHack 3D VR", questAppName)
    .replaceAll("Polypiled VR", questAppName)
    .replaceAll('"NetHack 3D"', `"${questAppName}"`);
  const oldName = 'variant.resValue "string", "app_name", variant.mergedFlavor.resValues.get("string/app_name").value + " (Dev)"';
  build = build.replace(oldName, `variant.resValue "string", "app_name", "${questAppName}"`);
  if (!build.includes("// NH3D launcher identity")) build += `
// NH3D launcher identity: applies to every flavor and build type.
android.applicationVariants.all { variant ->
    variant.resValue "string", "app_name", "${questAppName}"
}
`;
  writeFileSync(buildPath, build);
  if (!build.includes("apply from: 'nh3d-identity.gradle'")) {
    build += "\napply from: 'nh3d-identity.gradle'\n";
    writeFileSync(buildPath, build);
  }
  writeFileSync(path.join(checkout, "app/nh3d-identity.gradle"), `
// Generated from package.json and the Quest build counter.
android.defaultConfig {
    applicationId = "${questPackageId}"
    versionName = "${version.name}"
    versionCode = ${version.code}
    resValue "string", "app_name", "${questAppName}"
}
android.applicationVariants.all { variant ->
    variant.resValue "string", "app_name", "${questAppName}"
    variant.outputs.all { output ->
        output.versionNameOverride = "${version.name}"
        output.versionCodeOverride = ${version.code}
    }
}
`);
  const manifestPath = path.join(checkout, "app/src/main/AndroidManifest.xml");
  let manifest = readFileSync(manifestPath, "utf8")
    .replace(/android:label="(?:NetHack 3D VR|Polypiled VR|NetHack 3D|@string\/app_name)"/g, `android:label="${questAppName}"`)
    .replace('android:icon="@mipmap/ic_launcher"', 'android:icon="@drawable/nh3d_launcher"')
    .replace('android:roundIcon="@mipmap/ic_launcher_round"', 'android:roundIcon="@drawable/nh3d_launcher"');
  if (!manifest.includes('android:description=')) manifest = manifest.replace('<application', '<application android:description="@string/nh3d_app_description"');
  const values = path.join(checkout, "app/src/main/res/values");
  mkdirSync(values, { recursive: true });
  writeFileSync(path.join(values, "nh3d-description.xml"), '<resources><string name="nh3d_app_description">Polypiled is a NetHack variant you can explore in immersive 3D and virtual reality, with tabletop and first-person views.</string></resources>\n');
  // Meta's OS splash reads assets/vr_splash.png before the first app frame.
  if (!manifest.includes('android:name="com.oculus.ossplash"')) manifest = replaceOnce(manifest,
    "</application>", '    <meta-data android:name="com.oculus.ossplash" android:value="true"/>\n    </application>', "Quest system splash");
  writeFileSync(manifestPath, manifest);
  const assets = path.join(checkout, "app/src/main/assets");
  mkdirSync(assets, { recursive: true });
  copyFileSync(new URL("../../../public/NetHack3D-splash.png", import.meta.url), path.join(assets, "vr_splash.png"));
  const drawables = path.join(checkout, "app/src/main/res/drawable-nodpi");
  mkdirSync(drawables, { recursive: true });
  copyFileSync(new URL("../../../public/NetHack3D-splash.png", import.meta.url), path.join(drawables, "nh3d_launcher.png"));
}
