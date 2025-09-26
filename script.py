import json
import signal
import sys
from typing import Any, Callable, Dict, List, Optional, Sequence

import pyodbc

SERVER = '192.168.100.2,1433'

DATABASE = 'NAVIERA'

DRIVER = 'ODBC Driver 17 for SQL Server'

USE_WINDOWS_AUTH = False

SQL_USER = 'navexe'

SQL_PASS = 'navexe1433'

CONNECT_TIMEOUT = 10

def _build_conn_str() -> str:
    parts = [
        f"DRIVER={{{DRIVER}}};",
        f"SERVER={SERVER};",
        f"DATABASE={DATABASE};",
        "Encrypt=yes;",
        "TrustServerCertificate=yes;",
    ]
    if USE_WINDOWS_AUTH:
        parts.append("Trusted_Connection=yes;")
    else:
        parts.append(f"UID={SQL_USER};PWD={SQL_PASS};")
    return "".join(parts)

CONNECTION_STRING = _build_conn_str()

class ConnectionAcquireError(Exception):
    """Raised when the pool cannot establish a database connection."""
    def __init__(self, details: str) -> None:
        super().__init__(details)
        self.details = details

def _close_cursor(cursor: Optional['pyodbc.Cursor']) -> None:
    if cursor is None:
        return
    try:
        cursor.close()
    except pyodbc.Error:
        pass

def _execute_call(
    cursor: 'pyodbc.Cursor',
    call: str,
    params: Sequence[Any],

) -> None:
    if params:
        cursor.execute(call, tuple(params))
    else:
        cursor.execute(call)

class ConnectionPool:
    def __init__(self, size: int = 1):
        self._pool: List[pyodbc.Connection] = []
        self._max_size = max(1, size)
    def _create_connection(self) -> pyodbc.Connection:
        return pyodbc.connect(CONNECTION_STRING, timeout=CONNECT_TIMEOUT)
    def acquire(self) -> pyodbc.Connection:
        if self._pool:
            return self._pool.pop()
        try:
            return self._create_connection()
        except pyodbc.Error as exc:
            raise ConnectionAcquireError(str(exc)) from exc
    def release(self, conn: Optional[pyodbc.Connection]) -> None:
        if conn is None:
            return
        try:
            if len(self._pool) < self._max_size:
                self._pool.append(conn)
            else:
                conn.close()
        except pyodbc.Error:
            pass
    def discard(self, conn: Optional[pyodbc.Connection]) -> None:
        if conn is None:
            return
        try:
            conn.close()
        except pyodbc.Error:
            pass
    def close(self) -> None:
        while self._pool:
            conn = self._pool.pop()
            try:
                conn.close()
            except pyodbc.Error:
                pass

def execute_procedure(
    pool: ConnectionPool,
    call: str,
    params: Sequence[Any] = (),

) -> Dict[str, Any]:
    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}
    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        _execute_call(cursor, call, params)
        while cursor.description is None and cursor.nextset():
            pass
        if cursor.description is None:
            return {"columns": [], "rows": []}
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return {"columns": columns, "rows": rows}
    except pyodbc.Error as exc:
        pool.discard(conn)
        conn = None
        return {"error": "db_execute_failed", "details": str(exc)}
    finally:
        _close_cursor(cursor)
        pool.release(conn)

def run_procedure(
    pool: ConnectionPool,
    call: str,
    params: Sequence[Any] = (),

) -> Dict[str, Any]:
    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}
    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        _execute_call(cursor, call, params)
        conn.commit()
        return {"status": "ok"}
    except pyodbc.Error as exc:
        try:
            conn.rollback()
        except pyodbc.Error:
            pass
        pool.discard(conn)
        conn = None
        return {"error": "db_execute_failed", "details": str(exc)}
    finally:
        _close_cursor(cursor)
        pool.release(conn)

def get_clientes(pool: ConnectionPool) -> Dict[str, Any]:
    return execute_procedure(pool, "{CALL sp_traer_clientes}")

def update_cliente(
    pool: ConnectionPool,
    cod_cliente: Any,
    new_razon_social: Any,
    new_dom_fiscal: Any,
    new_cuit: Any,

) -> Dict[str, Any]:
    return run_procedure(
        pool,
        "{CALL editar_cliente (?, ?, ?, ?)}",
        (cod_cliente, new_razon_social, new_dom_fiscal, new_cuit),
    )

def modificar_cobros_impagos(pool: ConnectionPool) -> Dict[str, Any]:
    return run_procedure(pool, "{CALL modificar_cobros_impagos}")

def traer_incongruencias(pool: ConnectionPool) -> Dict[str, Any]:
    return execute_procedure(pool, "{CALL traer_incongruencias}")

def _handle_get_clientes(pool: ConnectionPool, params: Sequence[Any]) -> Dict[str, Any]:
    if params:
        return {
            "error": "invalid_params",
            "details": "get_clientes does not accept parameters",
        }
    return get_clientes(pool)

def _handle_update_cliente(pool: ConnectionPool, params: Sequence[Any]) -> Dict[str, Any]:
    if len(params) != 4:
        return {
            "error": "invalid_params",
            "details": "update_cliente expects 4 parameters",
        }
    return update_cliente(pool, *params)

def _handle_modificar_cobros_impagos(
    pool: ConnectionPool,
    params: Sequence[Any],

) -> Dict[str, Any]:
    if params:
        return {
            "error": "invalid_params",
            "details": "modificar_cobros_impagos does not accept parameters",
        }
    return modificar_cobros_impagos(pool)

def _handle_traer_incongruencias(
    pool: ConnectionPool,
    params: Sequence[Any],

) -> Dict[str, Any]:
    if params:
        return {
            "error": "invalid_params",
            "details": "traer_incongruencias does not accept parameters",
        }
    return traer_incongruencias(pool)

COMMAND_HANDLERS: Dict[str, Callable[[ConnectionPool, Sequence[Any]], Dict[str, Any]]] = {
    "get_clientes": _handle_get_clientes,
    "update_cliente": _handle_update_cliente,
    "modificar_cobros_impagos": _handle_modificar_cobros_impagos,
    "traer_incongruencias": _handle_traer_incongruencias,

}

def _normalize_params(raw: Any) -> List[Any]:
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return list(raw)
    return [raw]

def _dispatch(pool: ConnectionPool, cmd: str, params: Sequence[Any]) -> Dict[str, Any]:
    handler = COMMAND_HANDLERS.get(cmd)
    if handler is None:
        return {"error": "unknown command"}
    return handler(pool, params)

def main() -> None:
    pool = ConnectionPool()
    def _cleanup(*_args: Any) -> None:
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
            params = _normalize_params(payload.get("params"))
        except json.JSONDecodeError:
            cmd = line
            params = []
        if cmd == "exit":
            break
        if not cmd:
            res = {"error": "missing_command"}
        else:
            res = _dispatch(pool, cmd, params)
        print(json.dumps(res, default=str))
        sys.stdout.flush()
    pool.close()

if __name__ == "__main__":
    main()

