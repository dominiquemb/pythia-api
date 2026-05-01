module.exports = {
  apps: [
    {
      name: "astrology-api",
      script: "./server.js",
      instances: 1,
      exec_mode: "fork",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
