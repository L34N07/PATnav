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
npm run db:migrate:transfer-tables-permission
npm run db:migrate:transfer-identification-permission
npm run db:migrate:facultad-permission
npm run db:migrate:transferencias
npm run dev:linux
```

Place local database recovery files in `nav_data/` as `NAVIERAX.mdf` and
`NAVIERAX_1.ldf` before running `npm run db:start`. The helper creates or starts
the `patnav-sql` container, copies those files into the SQL Server data volume,
attaches them as the `NAVIERA` database, and creates the local `navexe` login
used by `script.py`.

For manual test snapshots of the local SQL Server database:

```bash
npm run db:backup
npm run db:restore
```

`db:backup` replaces `nav_data/NAVIERA_manual_backup.bak` with the current
`NAVIERA` state. `db:restore` loads that backup back into `NAVIERA`, closing
active local database connections while the restore runs.

`npm run db:migrate:transferencias` is idempotent. It creates the
`UsuariosTransferencia` account-owner mapping and the `Transferencias` history
table, including the unidentified owner placeholder used until a worker assigns
a receipt to a client and delivery location.

`npm run db:migrate:transfer-tables-permission` is also idempotent. It adds the
`View6` permission column used by the transfer table test view and updates
`update_user_permission` so the Admin Panel can save that permission.

`npm run db:migrate:transfer-identification-permission` adds the `View7`
permission used by the employee-facing transfer identification view.

`npm run db:migrate:facultad-permission` adds the `View8` permission used by the
Facultad invoice PDF view.

`UsuariosTransferencia` links accounts to `LugarEntrega` through the existing
composite key `cod_cliente` + `nro_lugar_entrega`. `Transferencias` stores the
detected `cvu_cbu`, `monto`, `fecha`, owner mapping, and `nombre_asociado` from
OCR. Before saving a receipt, the app checks for an exact existing match by
`cvu_cbu` + `monto` + `fecha`; duplicates are shown to the worker before any
extra row is inserted. Processed images are renamed with the `Procesada_`
prefix and shown with a processed marker in the UI.

The transfer identification view lists receipts still assigned to the
unidentified placeholder. Assigning a CBU/CVU creates the next ordered
`UsuariosTransferencia` row for the selected `cod_cliente` +
`nro_lugar_entrega` and updates every stored transfer with the same CBU/CVU.
Future processed receipts with that CBU/CVU resolve automatically.

The receipt scanner combines several OCR passes with the parser for the current
Mercado Pago receipt layout. Its parser tests can be run with:

```bash
npm run test:ocr
```

## ARCA CAE homologation dry-run

PATNav can build a first-pass ARCA invoice authorization payload from the local
legacy `NAVIERA` database without calling ARCA and without writing any database
changes. This is for homologation only.

The dry-run reads the local Docker SQL Server container created by
`npm run db:start`; it does not use the production SQL Server connection from
`script.py`. The script reads `Ventas`, `VentasItems`, `Cliente`, `Item`,
`LugarEntrega`, `CategoriaIva`, and `Talonario`, then prints the JSON that would
be sent to:

```text
POST https://arca.api.com.ar/api/wsfe/facturas
```

Configure the represented CUIT outside git, for example in your shell or an
ignored `.env` file:

```bash
export ARCA_REPRESENTADA_CUIT="<CUIT_EMISOR>"
```

Run a dry-run against an existing local invoice:

```bash
npm run db:start
npm run arca:dry-run -- --tipo FB --prefijo 7 --numero 48954 --fecha-homologacion 2026-09-02
```

Useful optional settings:

```bash
PATNAV_ARCA_HOMOLOGACION_PTO_VTA=6
PATNAV_ARCA_LEGACY_PRICE_MODE=gross
```

`PATNAV_ARCA_HOMOLOGACION_PTO_VTA` defaults to `6` and is intentionally separate
from the legacy `Ventas.prefijo`. `PATNAV_ARCA_LEGACY_PRICE_MODE=gross` treats
legacy item prices/importes as totals with IVA included and converts them to the
net `precioUnitario` expected by arca.api. Use `net` only after confirming the
legacy values are already net amounts.

Safety notes:

- The dry-run does not read or print `ARCA_API_KEY` unless
  `--consultar-ultimo-arca` is used.
- The dry-run does not make invoice HTTP requests.
- The dry-run does not execute `INSERT`, `UPDATE`, or `DELETE`.
- `PATNAV_ARCA_ENVIRONMENT` is blocked unless it is `homologacion`.
- Future live homologation calls should read the API key only from
  `ARCA_API_KEY` and use an explicit stable `Idempotency-Key`.

To query only the latest authorized number in homologation, add
`--consultar-ultimo-arca`. This reads `ARCA_API_KEY` from the environment and
calls `/api/wsfe/ultimo-comprobante`; it still does not emit an invoice or write
to the database.

### Abono generation flow

New electronic abonos should be authorized before they are inserted in NAVIERA.
The preview command reuses the legacy abono rules stored in the `NAVIERA`
database:

- candidate clients come from the same shape as `sp_traer_lugares_entrega_abono`,
  with the new rule `Cliente.tipo_cliente <> 2`, active client, active
  `LugarEntrega`;
- active assigned dispensers are read through `Dispenser.MControl2 = 'S'`;
- `Dispenser.cod_abono_o_alquiler` maps to `Item.cod_item`;
- dispensers with the same item are grouped into one `VentasItems` line;
- `cantidad` is the grouped dispenser count;
- `importe` is `cantidad * Item.precio`;
- `litros_abonados` is `cantidad * Item.litros_abonados`;
- `Ventas.fecha_vencimiento` is the abono period date:
  `YYYY-MM-dia_facturacion_abono`.

Preview a production range without issuing a CAE and without writing to the
database:

```bash
npm run arca:abonos -- --environment produccion --desde 2026-09-01 --hasta 2026-09-07 --representada 20220334857
```

The preview classifies `CategoriaIva.tipofactura` as `A -> FA/7` electronic,
`B -> FB/7` electronic, and `C -> FC/4` internal. Electronic abonos use
`concepto = 2`, service dates for the whole month, and net unit prices
calculated from the legacy gross prices.

After validating a preview, generation requires the explicit confirmation token
for the selected environment:

```bash
ARCA_API_KEY_PROD="<secret>" npm run arca:abonos -- --environment produccion --desde 2026-09-01 --hasta 2026-09-07 --representada 20220334857 --confirmar CONFIRMAR_ABONOS_PRODUCCION
```

If ARCA returns `resultado = "A"`, the script inserts `Ventas` and
`VentasItems` in one SQL transaction using the ARCA `cbteNro`, `cae`, and
`fecha_vencimiento_cae`. Internal `FC/4` abonos use `Talonario FC/4` and never
call ARCA.

Production Mode: Build and start

```bash
npm run build
npm start
```

Production DB over Tailscale:

```bash
npm run start:prod-db
```

For reopening the last built UI without rebuilding:

```bash
npm run start:prod-db:fast
```

These commands point the app at the DBeaver `NAVIERA 2` Tailscale connection,
`100.115.224.40,1433` / `NAVIERA`, and keep the local Docker database out of
the path. They load the built production UI while forcing the local Python
bridge with `PATNAV_USE_PYTHON_BRIDGE=1`.

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
