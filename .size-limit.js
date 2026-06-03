export default [
  {
    path: "dist/index.js",
    limit: "160 kB",
    modifyEsbuildConfig(config) {
      config.platform = "node";
      return config;
    },
  },
];
