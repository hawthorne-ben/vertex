module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        // Default to .env.local for development, use ENVFILE env var to override
        path: process.env.ENVFILE || '.env.local',
        safe: false,
        allowUndefined: false,
      },
    ],
    // Remove console.log in production builds only
    // Keeps console.warn and console.error (useful for production debugging)
    // This is triggered when NODE_ENV or BABEL_ENV is set to 'production'
    // The build-release.sh script sets these automatically
    ...(process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production'
      ? [
          [
            'transform-remove-console',
            {
              exclude: ['warn', 'error'],
            },
          ],
        ]
      : []),
  ],
};
