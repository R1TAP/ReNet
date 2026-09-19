/**
 * Developer helper script to prepare binary dependencies in `bin/`
 */
const fs = require('fs');
const path = require('path');

const binDir = path.join(__dirname, '..', 'bin');
const gnirehtetDir = path.join(__dirname, '..', 'Gnirehtet');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

console.log('[ReNet Setup] Checking binary tools in bin/...');

const requiredFiles = [
  'gnirehtet.exe',
  'gnirehtet.apk',
  'adb.exe',
  'AdbWinApi.dll',
  'AdbWinUsbApi.dll',
  'libwinpthread-1.dll'
];

let missing = [];

for (const f of requiredFiles) {
  const target = path.join(binDir, f);
  if (!fs.existsSync(target)) {
    const source = path.join(gnirehtetDir, f);
    if (fs.existsSync(source)) {
      console.log(`[ReNet Setup] Copying ${f} from Gnirehtet/...`);
      fs.copyFileSync(source, target);
    } else {
      missing.push(f);
    }
  }
}

if (missing.length > 0) {
  console.warn(`[ReNet Setup] ⚠️ Warning: Missing required files: ${missing.join(', ')}`);
  console.warn('[ReNet Setup] Please ensure you have downloaded Gnirehtet v2.5 and Android Platform-Tools.');
} else {
  console.log('[ReNet Setup] ✅ All required binaries are in place in bin/!');
}
