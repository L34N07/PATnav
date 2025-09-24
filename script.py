import json
import queue
import signal
import sys
import threading
import time
from typing import Optional

import pyodbc

SERVER = '192.168.100.3,1433'
DATABASE = 'NAVIERA'
DRIVER = 'ODBC Driver 18 for SQL Server'

USE_WINDOWS_AUTH = True
SQL_USER = 'navexe'
SQL_PASS = 'navexe1433'


def _build_conn_str() -> str:
    if USE_WINDOWS_AUTH:
        return (
            f"DRIVER={{{DRIVER}}};"
            f"SERVER={SERVER};"
            f"DATABASE={DATABASE};"
            "Trusted_Connection=yes;"
            "Encrypt=no;"
            "TrustServerCertificate=yes;"
        )
    return (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        f"UID={SQL_USER};"
        f"PWD={SQL_PASS};"
        "Encrypt=no;"
        "TrustServerCertificate=yes;"
    )


class ConnectionPool:

    def __init__(
        self,
        size: int = 5,
        connect_timeout: int = 10,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        self._size = size
        self._connect_timeout = connect_timeout
        self._max_retries = max_retries
        self._retry_delay = retry_delay
        self._pool: "queue.Queue[pyodbc.Connection]" = queue.Queue(maxsize=size)
        self._lock = threading.Lock()
        self._created = 0

    def acquire(self) -> pyodbc.Connection:
        try:
            conn = self._pool.get_nowait()
        except queue.Empty:
            conn = self._create_connection()
        return conn

    def release(self, conn: pyodbc.Connection) -> None:
        try:
            self._pool.put_nowait(conn)
        except queue.Full:
            conn.close()

    def close(self) -> None:
        while not self._pool.empty():
            conn = self._pool.get_nowait()
            conn.close()
        self._created = 0

    def _create_connection(self) -> pyodbc.Connection:
        with self._lock:
            if self._created >= self._size:
                wait_for_connection = True
            else:
                self._created += 1
                wait_for_connection = False

        if wait_for_connection:
            return self._pool.get()

        attempt = 0
        last_exc: Optional[Exception] = None
        while attempt < self._max_retries:
            attempt += 1
            try:
                conn = pyodbc.connect(_build_conn_str(), timeout=self._connect_timeout)
                return conn
            except pyodbc.Error as exc:
                last_exc = exc
                _log(f"Connection attempt {attempt} failed: {exc}")
                time.sleep(self._retry_delay)

        with self._lock:
            self._created -= 1

        assert last_exc is not None
        raise last_exc


def _log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)

def get_connection(pool: ConnectionPool) -> pyodbc.Connection:
    return pool.acquire()


def execute_procedure(pool: ConnectionPool, call: str, params=()):
    try:
        conn = get_connection(pool)
    except pyodbc.Error as exc:
        _log(f"Failed to acquire connection: {exc}")
        return {"error": str(exc)}
    try:
        cursor = conn.cursor()
        cursor.execute(call, params)

        while cursor.description is None and cursor.nextset():
            pass

        if cursor.description is None:
            return {"columns": [], "rows": []}

        columns = [c[0] for c in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return {"columns": columns, "rows": rows}
    except pyodbc.Error as exc:
        _log(f"Error running procedure '{call}': {exc}")
        return {"error": str(exc)}
    finally:
        pool.release(conn)


def run_procedure(pool: ConnectionPool, call: str, params=()) -> dict:
    try:
        conn = get_connection(pool)
    except pyodbc.Error as exc:
        _log(f"Failed to acquire connection: {exc}")
        return {"error": str(exc)}
    try:
        cursor = conn.cursor()
        cursor.execute(call, params)
        conn.commit()
        return {"status": "ok"}
    except pyodbc.Error as exc:
        try:
            conn.rollback()
        except pyodbc.Error:
            pass
        _log(f"Error running procedure '{call}': {exc}")
        return {"error": str(exc)}
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

        if not isinstance(params, (list, tuple)):
            params = [params]
        params = tuple(params)

        try:
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
        except Exception as exc:
            _log(f"Error handling command '{cmd}': {exc}")
            res = {"error": str(exc)}

        print(json.dumps(res, default=str))
        sys.stdout.flush()

    pool.close()

if __name__ == "__main__":
    main()
