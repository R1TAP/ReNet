const gnirehtet = require('./src/main/core/gnirehtet');

async function run() {
  await gnirehtet.start({ serial: '634751b', port: 31416 });
  setInterval(() => {}, 1000);
}

run();
