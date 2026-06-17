# PATnav
Proyecto ambicion total Naviera

## Development

Dev Mode: Install dependencies and start app

```bash
npm install
npm run dev
```

Temporary Linux dev mode with a local SQL Server Docker container:

```bash
npm install
yay -S unixodbc msodbcsql
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm run db:start
npm run dev:linux
```

Place local database recovery files in `nav_data/` as `NAVIERAX.mdf` and
`NAVIERAX_1.ldf` before running `npm run db:start`. The helper creates or starts
the `patnav-sql` container, copies those files into the SQL Server data volume,
attaches them as the `NAVIERA` database, and creates the local `navexe` login
used by `script.py`.

Production Mode: Build and start

```bash
npm run build
npm start
```

Executable App: Run to build the executable and uncompressed folder.

```bash
npm run dist
```

Windows builds use the packaged Python bridge executable. Linux dev mode runs
`script.py` directly with `python3` so the app can be tested without producing a
Linux PyInstaller build.

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
-Replace `SQL_USER` and `SQL_PASS`
-In windows menu go to 'Windows Defender Firewall with Advanced Security'->'Outbound Rules'->'New Rule'->'Port'->'Specific local ports = `1433`'->'Allow the connection'->'Uncheck public'->'Name it'


-Now you can run and build your app!
