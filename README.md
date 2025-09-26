# PATnav
Proyecto ambicion total Naviera

## Development

Dev Mode: Install dependencies and start app

```bash
npm install
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

The application no longer spawns the legacy `script.py` helper. Provide your preferred backend or data source when wiring up the client and irregularity tables.

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
