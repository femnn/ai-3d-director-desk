# Desktop packages

- `npm run desktop`: build and run the local Electron application.
- `npm run package:mac`: create unsigned macOS ARM64 DMG and ZIP packages.
- `npm run package:win`: create Windows x64 NSIS and portable EXE packages.

The packaged application starts the same director server used by the browser
launcher, serves the production `dist` bundle, and bundles platform-specific
FFmpeg and cloudflared binaries for MP4 export and secure phone access.
