import pyodbc

SERVER = '192.168.100.13,1433' 
DATABASE = 'NAVIERA'   
DRIVER = 'ODBC Driver 18 for SQL Server'

USE_WINDOWS_AUTH = True

SQL_USER = 'test123'
SQL_PASS = 'test123'

if USE_WINDOWS_AUTH:
    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        f"UID={SQL_USER};"
        f"PWD={SQL_PASS};"         
        "TrustServerCertificate=yes;"
    )
else:
    conn_str = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        f"UID={SQL_USER};"
        f"PWD={SQL_PASS};"
        "Encrypt=yes;"
        "TrustServerCertificate=no;"
    )

try:
    with pyodbc.connect(conn_str, timeout=5) as conn:
        cursor = conn.cursor()
        cursor.execute("{CALL sp_traer_clientes}")
        version = cursor.fetchone()[0]
        for row in cursor:
            print(row)
except Exception as e:
    print("Connection failed:")
    print(e)