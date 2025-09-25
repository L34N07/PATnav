import json
import logging
import os
import queue
import signal
import sys
from pathlib import Path
from typing import Any, Sequence, Tuple

import pyodbc

SERVER = '192.168.100.135,1433'
DATABASE = 'NAVIERA'
DRIVER = 'ODBC Driver 18 for SQL Server'

USE_WINDOWS_AUTH = False
SQL_USER = 'navexe'
SQL_PASS = 'navexe1433'


def _init_logger() -> Tuple[logging.Logger, Path]:
    level_name = os.getenv('PATNAV_LOG_LEVEL', 'INFO').upper()
    level = getattr(logging, level_name, logging.INFO)

    candidate_dir = Path(os.getenv('PATNAV_LOG_DIR', Path(__file__).resolve().parent))
    log_file = candidate_dir / 'script.log'
    handler = None

    for directory in (candidate_dir, Path.cwd()):
        try:
            directory.mkdir(parents=True, exist_ok=True)
            log_file = directory / 'script.log'
            handler = logging.FileHandler(log_file, encoding='utf-8')
            break
        except Exception:
            pass

    if handler is None:
        handler = logging.StreamHandler(sys.stderr)

    formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    handler.setFormatter(formatter)

    logger = logging.getLogger('patnav.script')
    if not logger.handlers:
        logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False
    logger.debug('Logging initialised at %s (level=%s)', log_file, level_name)
    return logger, log_file


LOGGER, LOG_FILE = _init_logger()


def _build_conn_str() -> str:
    base = (
        f"DRIVER={{{DRIVER}}};"
        f"SERVER={SERVER};"
        f"DATABASE={DATABASE};"
        'Encrypt=yes;'
        'TrustServerCertificate=yes;'
    )
    if USE_WINDOWS_AUTH:
        # Windows (Integrated) authentication -- no UID/PWD
        return base + 'Trusted_Connection=yes;'
    return base + f'UID={SQL_USER};PWD={SQL_PASS};'


class ConnectionPool:

    def __init__(self, size: int = 1):
        self._pool: "queue.Queue[pyodbc.Connection]" = queue.Queue(maxsize=size)
        for _ in range(size):
            try:
                conn = pyodbc.connect(_build_conn_str(), timeout=10)
            except pyodbc.Error as exc:
                LOGGER.exception('Failed to open database connection: %s', exc)
                raise
            self._pool.put(conn)
        LOGGER.debug('Connection pool initialised with size %d', size)

    def acquire(self) -> pyodbc.Connection:
        conn = self._pool.get()
        LOGGER.debug('Connection acquired from pool')
        return conn

    def release(self, conn: pyodbc.Connection) -> None:
        self._pool.put(conn)
        LOGGER.debug('Connection returned to pool')

    def close(self) -> None:
        LOGGER.debug('Closing connection pool')
        while not self._pool.empty():
            conn = self._pool.get_nowait()
            try:
                conn.close()
            except Exception as exc:
                LOGGER.warning('Error closing connection: %s', exc)


def get_connection(pool: ConnectionPool) -> pyodbc.Connection:
    return pool.acquire()


def execute_procedure(pool: ConnectionPool, call: str, params: Sequence[Any] = ()): 
    LOGGER.debug('Executing procedure %s with %d params', call, len(params))
    conn = get_connection(pool)
    cursor = None
    try:
        cursor = conn.cursor()
        try:
            cursor.execute(call, params)
        except pyodbc.Error as exc:
            LOGGER.exception('Database execution failed for %s', call)
            return {'error': 'db_execute_failed', 'details': str(exc)}

        while cursor.description is None and cursor.nextset():
            pass
        if cursor.description is None:
            LOGGER.debug('Procedure %s returned no result set', call)
            return {'columns': [], 'rows': []}

        columns = [c[0] for c in cursor.description]
        rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        LOGGER.debug('Procedure %s returned %d rows', call, len(rows))
        return {'columns': columns, 'rows': rows}
    except Exception as exc:
        LOGGER.exception('Unhandled error during procedure %s', call)
        return {'error': 'internal_error', 'details': str(exc)}
    finally:
        if cursor is not None:
            try:
                cursor.close()
            except Exception:
                LOGGER.debug('Cursor close raised but ignored', exc_info=True)
        pool.release(conn)


def run_procedure(pool: ConnectionPool, call: str, params: Sequence[Any] = ()) -> dict:
    LOGGER.debug('Running procedure %s with %d params', call, len(params))
    conn = get_connection(pool)
    try:
        cursor = conn.cursor()
        cursor.execute(call, params)
        conn.commit()
        LOGGER.debug('Procedure %s committed successfully', call)
        return {'status': 'ok'}
    except pyodbc.Error as exc:
        LOGGER.exception('Database execution failed for %s', call)
        return {'error': 'db_execute_failed', 'details': str(exc)}
    except Exception as exc:
        LOGGER.exception('Unhandled error running procedure %s', call)
        return {'error': 'internal_error', 'details': str(exc)}
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
    LOGGER.info('Python bridge started (pid=%s); log file=%s', os.getpid(), LOG_FILE)
    pool = ConnectionPool()

    def _cleanup(*_args):
        LOGGER.info('Shutting down bridge process')
        pool.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, _cleanup)
    signal.signal(signal.SIGTERM, _cleanup)

    for line in sys.stdin:
        raw_line = line.strip()
        if not raw_line:
            continue

        LOGGER.debug('Received raw payload: %s', raw_line[:500])

        try:
            payload = json.loads(raw_line)
            cmd = payload.get('cmd')
            params = payload.get('params', [])
        except json.JSONDecodeError:
            LOGGER.warning('Received non-JSON payload, treating as command string')
            cmd = raw_line
            params = []
        except Exception as exc:
            LOGGER.exception('Failed to parse payload')
            print(json.dumps({'error': 'payload_parse_failed', 'details': str(exc)}))
            sys.stdout.flush()
            continue

        LOGGER.info('Handling command: %s', cmd)

        try:
            if cmd == 'get_clientes':
                res = get_clientes(pool)
            elif cmd == 'update_cliente':
                res = update_cliente(pool, *params)
            elif cmd == 'modificar_cobros_impagos':
                res = modificar_cobros_impagos(pool)
            elif cmd == 'traer_incongruencias':
                res = traer_incongruencias(pool)
            elif cmd == 'exit':
                LOGGER.info('Exit command received')
                break
            else:
                LOGGER.warning('Unknown command received: %s', cmd)
                res = {'error': 'unknown_command'}
        except Exception as exc:
            LOGGER.exception('Unhandled exception handling command %s', cmd)
            res = {'error': 'internal_error', 'details': str(exc)}

        print(json.dumps(res, default=str))
        sys.stdout.flush()
        LOGGER.debug('Response sent for command %s', cmd)

    LOGGER.info('Main loop ending, closing pool')
    pool.close()


if __name__ == '__main__':
    main()
