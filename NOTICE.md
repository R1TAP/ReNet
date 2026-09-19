# Third-Party Notices & Licenses

ReNet incorporates or interfaces with the following third-party components:

---

## 1. Gnirehtet
- **Author**: Genymobile (Romain Vimont / rom1v)
- **Repository**: https://github.com/Genymobile/gnirehtet
- **License**: Apache License 2.0
- **Summary**: Gnirehtet provides reverse tethering for Android. It routes TCP and DNS packets from Android devices to desktop host machines.

---

## 2. Android SDK Platform-Tools (adb)
- **Author**: Google LLC
- **Terms & Conditions**: https://developer.android.com/studio/terms
- **Notice**: ADB (Android Debug Bridge) is a component of the Android Open Source Project (AOSP) and Android SDK Platform-Tools.
- **Compliance Note**:
  `adb.exe`, `AdbWinApi.dll`, and `AdbWinUsbApi.dll` are proprietary builds provided by Google LLC under Android SDK Terms.
  ReNet supports using the system-installed ADB (`adb.exe` from system PATH) or a custom specified ADB path, in addition to bundled local tools.
  Developers cloning this repository from GitHub can run `npm run setup-tools` to download or configure their own platform-tools binaries.

---

## 3. Electron
- **Author**: OpenJS Foundation and Electron contributors
- **License**: MIT License
