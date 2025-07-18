# PATnav
Proyecto ambicion total Naviera

## Development

Dev Mode: Install dependencies and start app

```bash
npm install
pip install pyodbc
npm run dev
```

Production Mode: Build and start

```bash
npm run build
npm start
```

Executable App: Run to build the executable and uncompressed folder.

```bash
npm run dist
```

Make sure the system has Python and its dependencies (like `pyodbc`)
installed, as the packaged app spawns `script.py` at runtime.

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

The script will cleanly close its pool and Vite server when the Electron app quits.

## Server Setup

To setup the server follow the following steps:

(On server side)

```bash
ipconfig
```
-Look for IPV4 

-Open SQL Server Configuration Manager
-Look for 'SQL Server Network Configuration'
-Look for 'TCP/IP'
-Switch to 'Enable'
-On the same window go to 'IP Addresses' and look for IPAll
-Leave dynamic ports `NULL` and set 'TCP Port' to something like `1433`
-Now open 'SQL Server Management Studio' right click your server. Go to 'properties'->'Security'.
-Switch 'Server Auth' to `SQL Server and Windows Authentification mode`

```SQL
CREATE LOGIN my_app_user
  WITH PASSWORD = 'A_Very_Strong_P@ssw0rd!';
ALTER SERVER ROLE [sysadmin] ADD MEMBER my_app_user;
```
-In windows menu go to 'Windows Defender Firewall with Advanced Security'->'Inbound Rules'->'New Rule'->'Port'->'Specific local ports = `1433`'->'Allow the connection'->'Uncheck public'->'Name it'
 
(On CLient side)

-Replace `SERVER` with the IP addres followed by the port `192.xxx.xxx.x,1433`
-Replace `SQL_USER` and `SQL_PASS
-In windows menu go to 'Windows Defender Firewall with Advanced Security'->'Outbound Rules'->'New Rule'->'Port'->'Specific local ports = `1433`'->'Allow the connection'->'Uncheck public'->'Name it'


-Now you can run and build your app!