# Thoongatha Da

A funny browser-only study camera app that watches both eyes locally with MediaPipe and plays the supplied Tamil dialogue clip when both eyes stay closed for about one second.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

Import this folder/repo in Vercel as a Vite app:

- Build command: `npm run build`
- Output directory: `dist`

Camera frames stay on-device. The app does not upload or record webcam footage.
