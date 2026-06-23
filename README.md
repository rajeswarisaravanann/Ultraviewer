# UltraViewer Lite

## Setup

1. cd server && npm install
2. cd ..
3. cd client && npm install
   (postinstall auto-runs: npx @electron/rebuild -f -w robotjs)
4. If robotjs rebuild fails on Windows, run as Administrator:
   npx @electron/rebuild -f -w robotjs

## Run

Terminal 1:
```
cd server
npm start
```

Terminal 2:
```
cd client
npm start
```

## If you get ETARGET or version errors
- Delete `node_modules` and `package-lock.json` in `client/`
- Run: `npm cache clean --force`
- Run: `npm install` again
