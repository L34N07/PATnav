import pyodbc
import json

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
        columns = [c[0] for c in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        print(json.dumps({'columns': columns, 'rows': rows}, default=str))
except Exception as e:
    print("Connection failed:")
    print(e)
