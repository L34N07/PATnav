import pyodbc
import json
import sys
import queue
import signal

SERVER = '192.168.100.3,1433'
DATABASE = 'NAVIERA'
DRIVER = 'ODBC Driver 18 for SQL Server'

USE_WINDOWS_AUTH = False
SQL_USER = 'navexe'
SQL_PASS = 'navexe1433'


def _build_conn_str() -> str:
    base = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        "Encrypt=yes;"
        "TrustServerCertificate=yes;"
    )
    if USE_WINDOWS_AUTH:
        # Windows (Integrated) authentication — no UID/PWD
        return base + "Trusted_Connection=yes;"
    else:
        return base + f"UID={SQL_USER};PWD={SQL_PASS};"


class ConnectionPool:

    def __init__(self, size: int = 1):
        self._pool: "queue.Queue[pyodbc.Connection]" = queue.Queue(maxsize=size)
        for _ in range(size):
            self._pool.put(pyodbc.connect(_build_conn_str(), timeout=10))

    def acquire(self) -> pyodbc.Connection:
        return self._pool.get()

    def release(self, conn: pyodbc.Connection) -> None:
        self._pool.put(conn)

    def close(self) -> None:
        while not self._pool.empty():
            conn = self._pool.get_nowait()
            conn.close()

def get_connection(pool: ConnectionPool) -> pyodbc.Connection:
    return pool.acquire()

def execute_procedure(pool: ConnectionPool, call: str, params=()):
    conn = get_connection(pool)
    try:
        cursor = conn.cursor()
        try:
            cursor.execute(call, params)
        except pyodbc.Error as e:
            return {"error": "db_execute_failed", "details": str(e)}

        while cursor.description is None and cursor.nextset():
            pass
        if cursor.description is None:
            return {"columns": [], "rows": []}

        columns = [c[0] for c in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return {"columns": columns, "rows": rows}
    finally:
        try:
            cursor.close()
        except Exception:
            pass
        pool.release(conn)

def run_procedure(pool: ConnectionPool, call: str, params=()) -> dict:
    conn = get_connection(pool)
    try:
        cursor = conn.cursor()
        cursor.execute(call, params)
        conn.commit()
        return {"status": "ok"}
    finally:
        pool.release(conn)

def get_clientes(pool: ConnectionPool):
    return execute_procedure(pool, '{CALL sp_traer_clientes}')

def update_cliente(pool: ConnectionPool, cod_cliente, new_razon_social, new_dom_fiscal, new_cuit):
    return run_procedure(
        pool,
        '{CALL editar_cliente (?, ?, ?, ?)}',
        (cod_cliente, new_razon_social, new_dom_fiscal, new_cuit)
    )

def modificar_cobros_impagos(pool: ConnectionPool):
    return run_procedure(pool, '{CALL modificar_cobros_impagos}')

def traer_incongruencias(pool: ConnectionPool):
    return execute_procedure(pool, '{CALL traer_incongruencias}')

def main() -> None:
    pool = ConnectionPool()

    def _cleanup(*_args):
        pool.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, _cleanup)
    signal.signal(signal.SIGTERM, _cleanup)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            cmd = payload.get("cmd")
            params = payload.get("params", [])
        except json.JSONDecodeError:
            cmd = line
            params = []

        if cmd == "get_clientes":
            res = get_clientes(pool)
        elif cmd == "update_cliente":
            res = update_cliente(pool, *params)
        elif cmd == "modificar_cobros_impagos":
            res = modificar_cobros_impagos(pool)
        elif cmd == "traer_incongruencias":
            res = traer_incongruencias(pool)
        elif cmd == "exit":
            break
        else:
            res = {"error": "unknown command"}

        print(json.dumps(res, default=str))
        sys.stdout.flush()

    pool.close()

if __name__ == "__main__":
    main()