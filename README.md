# PATnav
Proyecto ambicion total Naviera

## Development

Install dependencies and start the application:

```bash
npm install
npm run dev
```

The Electron window will load the Vite development server.

## Python helper script

`script.py` now starts a small process that keeps a pool of database
connections alive. Electron launches this process when the application
starts and communicates with it through standard input/output.

To fetch clients from the app you can invoke:

```ts
window.electronAPI.runPython('get_clientes')
```

The script will cleanly close its pool when the Electron app quits.
