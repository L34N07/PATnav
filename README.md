# PATnav
Proyecto ambicion total Naviera

## Development

Install dependencies and start the application:

```bash
npm install
npm run dev
```

For a production build run:

```bash
npm run build
npm start
```

To generate an installer or portable package using electron-builder:

```bash
npm run dist
```

Make sure the system has Python and its dependencies (like `pyodbc`)
installed, as the packaged app spawns `script.py` at runtime.

The Electron window will load the Vite development server.

## Python helper script

`script.py` now starts a small process that keeps a pool of database
connections alive. Electron launches this process when the application
starts and communicates with it through standard input/output.

To run Python commands from the renderer you can call:

```ts
window.electronAPI.runPython(cmd, params?)
```

Where `cmd` is the command string (for example `'get_clientes'`) and `params` is
an optional array of arguments. A simple call fetching clients would look like:

```ts
window.electronAPI.runPython('get_clientes')
```

The script will cleanly close its pool when the Electron app quits.
