/** PM2 — autostart strony + emulatora bazy na Malinie. */
module.exports = {
  apps: [
    {
      name: "party-web",
      script: "/home/stas/.npm-global/bin/serve",
      args: ["-s", "/home/stas/dist", "-l", "tcp://0.0.0.0:80"],
      cwd: "/home/stas",
      autorestart: true,
      max_restarts: 10,
      env: {
        PATH: "/home/stas/.nvm/versions/node/v24.16.0/bin:/home/stas/.npm-global/bin:/usr/local/bin:/usr/bin:/bin",
      },
    },
    {
      name: "firebase-db",
      script: "/usr/bin/bash",
      args: ["-c", "firebase emulators:start --only database --project party-games-14ae8"],
      cwd: "/home/stas",
      autorestart: true,
      max_restarts: 5,
      env: {
        PATH: "/home/stas/.nvm/versions/node/v24.16.0/bin:/home/stas/.npm-global/bin:/usr/local/bin:/usr/bin:/bin",
      },
    },
  ],
};
