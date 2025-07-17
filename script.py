import pyodbc
import json
import sys
import queue
import signal

# Database connection settings
SERVER = '192.168.100.13,1433'
DATABASE = 'NAVIERA'
DRIVER = 'ODBC Driver 18 for SQL Server'

USE_WINDOWS_AUTH = True
SQL_USER = 'test123'
SQL_PASS = 'test123'


def _build_conn_str() -> str:
    """Return a pyodbc connection string."""
    if USE_WINDOWS_AUTH:
        return (
            f"DRIVER={{{DRIVER}}};"
            f"SERVER={SERVER};"
            f"DATABASE={DATABASE};"
            f"UID={SQL_USER};"
            f"PWD={SQL_PASS};"
            "TrustServerCertificate=yes;"
        )
    return (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        f"UID={SQL_USER};"
        f"PWD={SQL_PASS};"
        "Encrypt=yes;"
        "TrustServerCertificate=no;"
    )


class ConnectionPool:
    """Very small connection pool for reusing database connections."""

    def __init__(self, size: int = 5):
        self._pool: "queue.Queue[pyodbc.Connection]" = queue.Queue(maxsize=size)
        for _ in range(size):
            self._pool.put(pyodbc.connect(_build_conn_str(), timeout=5))

    def acquire(self) -> pyodbc.Connection:
        return self._pool.get()

    def release(self, conn: pyodbc.Connection) -> None:
        self._pool.put(conn)

    def close(self) -> None:
        while not self._pool.empty():
            conn = self._pool.get_nowait()
            conn.close()


def get_connection(pool: ConnectionPool) -> pyodbc.Connection:
    """Get a connection from the provided pool."""
    return pool.acquire()


def execute_procedure(pool: ConnectionPool, call: str, params=()):
    """Execute a stored procedure using a pooled connection."""
    conn = get_connection(pool)
    try:
        cursor = conn.cursor()
        cursor.execute(call, params)
        columns = [c[0] for c in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return {"columns": columns, "rows": rows}
    finally:
        pool.release(conn)


def get_clientes(pool: ConnectionPool):
    """Return the result of the `sp_traer_clientes` procedure."""
    return execute_procedure(pool, '{CALL sp_traer_clientes}')


def update_cliente(pool: ConnectionPool, cod_cliente, new_razon_social, new_dom_fiscal1):
    """Call the `new_edit_cliente` procedure with the given arguments."""
    return execute_procedure(
        pool,
        '{CALL new_edit_cliente (?, ?, ?)}',
        (cod_cliente, new_razon_social, new_dom_fiscal1)
    )


def run_procedure(pool: ConnectionPool, call: str, params=()) -> dict:
    """Execute a procedure that does not return a result set."""
    conn = get_connection(pool)
    try:
        cursor = conn.cursor()
        cursor.execute(call, params)
        conn.commit()
        return {"status": "ok"}
    finally:
        pool.release(conn)


def modificar_cobros_impagos(pool: ConnectionPool):
    """Execute the `modificar_cobros_impagos` procedure."""
    return run_procedure(pool, '{CALL modificar_cobros_impagos}')


def traer_incongruencias(pool: ConnectionPool):
    """Return the result of the `traer_incongruencias` procedure."""
    return execute_procedure(pool, '{CALL traer_incongruencias}')


def main() -> None:
    """Run a small command loop reading JSON from stdin."""
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
