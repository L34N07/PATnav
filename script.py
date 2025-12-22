import json
import os
import re
import signal
import sys
from datetime import date, datetime
from typing import Any, Callable, Dict, List, Optional, Sequence

import pyodbc

try:
    from PIL import Image
except ImportError:
    Image = None  # type: ignore

try:
    import pytesseract

    _SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    _MEIPASS_DIR = getattr(sys, "_MEIPASS", None)
    _RESOURCE_HINT = os.environ.get("ELECTRON_RESOURCES_PATH")

    def _gather_resource_roots() -> List[str]:
        roots: List[str] = []
        for value in (_RESOURCE_HINT, _SCRIPT_DIR, _MEIPASS_DIR):
            if value and value not in roots:
                roots.append(value)
        if not roots:
            roots.append(os.getcwd())
        return roots

    _RESOURCE_ROOTS = _gather_resource_roots()

    def _resolve_tesseract_path() -> str:
        for base_dir in _RESOURCE_ROOTS:
            candidate = os.path.join(base_dir, "Tesseract", "tesseract.exe")
            if os.path.isfile(candidate):
                return candidate
        return os.path.join(_RESOURCE_ROOTS[0], "Tesseract", "tesseract.exe")

    TESS_PATH = _resolve_tesseract_path()
    pytesseract.pytesseract.tesseract_cmd = TESS_PATH
    tess_dir = os.path.dirname(TESS_PATH)
    current_path = os.environ.get("PATH", "")
    if tess_dir not in current_path.split(os.pathsep):
        os.environ["PATH"] = tess_dir + (os.pathsep + current_path if current_path else "")
    os.environ.setdefault("TESSDATA_PREFIX", os.path.join(tess_dir, "tessdata"))
except ImportError:
    pytesseract = None  # type: ignore

SERVER = '192.168.100.138,1433'

DATABASE = 'NAVIERA'

DRIVER = 'ODBC Driver 18 for SQL Server'

USE_WINDOWS_AUTH = False

SQL_USER = 'navexe'

SQL_PASS = 'navexe1433'

CONNECT_TIMEOUT = 10

CURRENCY_PATTERN = re.compile(r'\$\s*([0-9][0-9.\s,]*)')
ACCOUNT_PATTERN = re.compile(r'(C[VB]U)\s*[:=\-]?\s*([0-9O\s]{6,})', re.IGNORECASE)
CREATED_PATTERN = re.compile(
    r"creada\s+el\s+(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s*[-–]\s*([0-9]{1,2}:[0-9]{2})",
    re.IGNORECASE
)
MONTH_MAP = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "november": 11,
    "diciembre": 12,
}

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

def get_app_user(pool: ConnectionPool, username: Any) -> Dict[str, Any]:
    return execute_procedure(pool, "EXEC traer_appUser @userName=?", (username,))


def get_app_users_by_type(pool: ConnectionPool, user_type: Any) -> Dict[str, Any]:
    return execute_procedure(
        pool,
        "EXEC traer_appUsers_por_tipo @userType=?",
        (user_type,),
    )


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


def resumen_remitos(pool: ConnectionPool) -> Dict[str, Any]:
    return run_procedure(pool, "{CALL resumen_remitos}")


def traer_resumen_prestamos(pool: ConnectionPool) -> Dict[str, Any]:
    return execute_procedure(pool, "{CALL traer_resumen_prestamos}")

def traer_facturas_atrasadas(pool: ConnectionPool) -> Dict[str, Any]:
    return execute_procedure(pool, "{CALL traer_facturas_atrasadas}")

def traer_ignorar(pool: ConnectionPool) -> Dict[str, Any]:
    return execute_procedure(pool, "{CALL traer_ignorar}")


def traer_movimientos_cliente(
    pool: ConnectionPool, cod_cliente: Any, subcodigo: Any = ""
) -> Dict[str, Any]:
    normalized_subcodigo = "" if subcodigo is None else str(subcodigo).strip()
    return execute_procedure(
        pool,
        "{CALL traer_movimientos_cliente (?, ?)}",
        (cod_cliente, normalized_subcodigo),
    )


def actualizar_infoextra_por_registro(
    pool: ConnectionPool,
    numero_remito: Any,
    prefijo_remito: Any,
    tipo_comprobante: Any,
    nro_orden: Any,
    infoextra: Any,
) -> Dict[str, Any]:
    return run_procedure(
        pool,
        "{CALL actualizar_infoextra_por_registro (?, ?, ?, ?, ?)}",
        (numero_remito, prefijo_remito, tipo_comprobante, nro_orden, infoextra),
    )

def actualizar_nuevo_stock(
    pool: ConnectionPool,
    tipo_comprobante: Any,
    prefijo_remito: Any,
    numero_remito: Any,
    nro_orden: Any,
    nuevo_stock: Any,
) -> Dict[str, Any]:
    return run_procedure(
        pool,
        "{CALL actualizar_nuevo_stock (?, ?, ?, ?, ?)}",
        (tipo_comprobante, prefijo_remito, numero_remito, nro_orden, nuevo_stock),
    )


def update_user_permissions(
    pool: ConnectionPool,
    user_id: Any,
    permissions: Dict[str, Any],

) -> Dict[str, Any]:
    try:
        parsed_user_id = int(user_id)
    except (TypeError, ValueError):
        return {
            "error": "invalid_params",
            "details": "user_id must be an integer",
        }

    if not isinstance(permissions, dict):
        return {
            "error": "invalid_params",
            "details": "permissions must be a mapping",
        }

    test_view = 1 if bool(permissions.get("testView")) else 0
    test_view2 = 1 if bool(permissions.get("testView2")) else 0
    View3 = 1 if bool(permissions.get("View3")) else 0
    View4 = 1 if bool(permissions.get("View4")) else 0

    result = run_procedure(
        pool,
        "{CALL update_user_permission (?, ?, ?, ?, ?)}",
        (parsed_user_id, test_view, test_view2, View3, View4),
    )

    if result.get("error") == "db_execute_failed":
        details = str(result.get("details", "")).lower()
        if "too many" in details or "arguments" in details:
            return run_procedure(
                pool,
                "{CALL update_user_permission (?, ?, ?, ?)}",
                (parsed_user_id, test_view, test_view2, View3),
            )

    return result


def ingresar_registro_hoja_de_ruta(
    pool: ConnectionPool,
    motivo: Any,
    detalle: Any,
    recorrido: Any,
    fecha_recorrido: Any,
) -> Dict[str, Any]:
    if motivo is None or detalle is None or recorrido is None or fecha_recorrido is None:
        return {"error": "invalid_params", "details": "All fields are required"}

    motivo_value = str(motivo).strip()
    detalle_value = str(detalle).strip()
    recorrido_value = str(recorrido).strip()
    fecha_raw = str(fecha_recorrido).strip()

    if not motivo_value:
        return {"error": "invalid_params", "details": "motivo is required"}
    if len(motivo_value) > 15:
        return {"error": "invalid_params", "details": "motivo must be 15 characters or fewer"}

    if not detalle_value:
        return {"error": "invalid_params", "details": "detalle is required"}
    if len(detalle_value) > 100:
        return {"error": "invalid_params", "details": "detalle must be 100 characters or fewer"}

    if not recorrido_value:
        return {"error": "invalid_params", "details": "recorrido is required"}
    if len(recorrido_value) > 4:
        return {"error": "invalid_params", "details": "recorrido must be 4 characters or fewer"}

    try:
        if isinstance(fecha_recorrido, datetime):
            fecha_value: date = fecha_recorrido.date()
        elif isinstance(fecha_recorrido, date):
            fecha_value = fecha_recorrido
        else:
            fecha_value = datetime.strptime(fecha_raw, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return {
            "error": "invalid_params",
            "details": "fecha_recorrido must be a date in YYYY-MM-DD format",
        }

    fecha_recorrido_value = fecha_value.isoformat()
    fecha_ingreso_value = datetime.now().date().isoformat()
    return run_procedure(
        pool,
        (
            "EXEC Ingresar_registro_hoja_de_ruta "
            "@motivo=?, @detalle=?, @recorrido=?, @fecha_recorrido=?, @fecha_ingreso=?"
        ),
        (motivo_value, detalle_value, recorrido_value, fecha_recorrido_value, fecha_ingreso_value),
    )


def traer_hoja_de_ruta_por_dia(
    pool: ConnectionPool,
    dia_recorrido: Any,
) -> Dict[str, Any]:
    if dia_recorrido is None:
        return {"error": "invalid_params", "details": "dia_recorrido is required"}

    dia_value = str(dia_recorrido).strip().upper()
    allowed = {"L", "M", "X", "J", "V", "S"}
    if dia_value not in allowed:
        return {
            "error": "invalid_params",
            "details": "dia_recorrido must be one of L, M, X, J, V, S",
        }

    return execute_procedure(
        pool,
        "EXEC Traer_hoja_de_ruta_por_dia @dia_recorrido=?",
        (dia_value,),
    )


def traer_hoja_de_ruta(pool: ConnectionPool) -> Dict[str, Any]:
    return execute_procedure(pool, "EXEC traer_hoja_de_ruta")

def insertar_envases_en_hoja_de_ruta(pool: ConnectionPool) -> Dict[str, Any]:
    return run_procedure(pool, "EXEC InsertarEnvasesEnHojaDeRuta")

def editar_registro_hdr(
    pool: ConnectionPool,
    motivo: Any,
    detalle: Any,
    nuevo_detalle: Any,
    recorrido: Any,
    fechas_recorrido: Any,
) -> Dict[str, Any]:
    motivo_value = str(motivo).strip()
    detalle_value = str(detalle).strip()
    nuevo_detalle_value = str(nuevo_detalle).strip()
    recorrido_value = str(recorrido).strip()
    fecha_raw = str(fechas_recorrido).strip()

    if not motivo_value:
        return {"error": "invalid_params", "details": "motivo is required"}
    if len(motivo_value) > 15:
        return {"error": "invalid_params", "details": "motivo must be 15 characters or fewer"}

    if detalle is None:
        return {"error": "invalid_params", "details": "detalle is required"}
    if len(detalle_value) > 100:
        return {"error": "invalid_params", "details": "detalle must be 100 characters or fewer"}

    if nuevo_detalle is None:
        return {"error": "invalid_params", "details": "nuevo_detalle is required"}
    if not nuevo_detalle_value:
        return {"error": "invalid_params", "details": "nuevo_detalle cannot be empty"}
    if len(nuevo_detalle_value) > 100:
        return {
            "error": "invalid_params",
            "details": "nuevo_detalle must be 100 characters or fewer",
        }

    if not recorrido_value:
        return {"error": "invalid_params", "details": "recorrido is required"}
    if len(recorrido_value) > 4:
        return {"error": "invalid_params", "details": "recorrido must be 4 characters or fewer"}

    try:
        if isinstance(fechas_recorrido, datetime):
            fecha_value: date = fechas_recorrido.date()
        elif isinstance(fechas_recorrido, date):
            fecha_value = fechas_recorrido
        else:
            fecha_value = datetime.strptime(fecha_raw, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return {
            "error": "invalid_params",
            "details": "fechas_recorrido must be a date in YYYY-MM-DD format",
        }

    return run_procedure(
        pool,
        "{CALL editar_registro_hdr (?, ?, ?, ?, ?)}",
        (motivo_value, detalle_value, nuevo_detalle_value, recorrido_value, fecha_value),
    )


def _clean_holder_value(value: str) -> str:
    cleaned = re.sub(r"^[^\w]+", "", value).strip()
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    tokens = cleaned.split()
    if len(tokens) >= 2 and len(tokens[0]) == 1:
        cleaned = " ".join(tokens[1:])
    return cleaned


def _extract_currency_amount(text: str) -> Optional[str]:
    if not text:
        return None
    for match in CURRENCY_PATTERN.finditer(text):
        raw = match.group(1)
        cleaned = raw.replace(" ", "")
        if cleaned:
            return cleaned
    return None


def _extract_account_match(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None

    previous_line = ""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        match = ACCOUNT_PATTERN.search(line)
        if match:
            account_type = match.group(1).upper().replace(" ", "")
            raw_digits = match.group(2).upper().replace("O", "0")
            digits = re.sub(r"\D", "", raw_digits)
            if len(digits) >= 10:
                if len(digits) > 22:
                    digits = digits[:22]
                normalized_type = "CVU" if account_type.startswith("CV") else "CBU"
                holder = _clean_holder_value(previous_line)
                holder_value = holder or None
                return {"type": normalized_type, "number": digits, "holder": holder_value}

        previous_line = line

    return None


def _extract_created_timestamp(text: str) -> Optional[str]:
    if not text:
        return None

    current_year = datetime.now().year

    for match in CREATED_PATTERN.finditer(text):
        day = match.group(1)
        month_name = match.group(2).strip().lower()
        time_value = match.group(3)
        month = MONTH_MAP.get(month_name)
        if not month:
            continue
        day_number = int(day)
        formatted_date = f"{day_number:02d}/{month:02d}/{current_year}"
        return f"{formatted_date} - {time_value}"

    return None


def analyze_upload_image(
    pool: ConnectionPool,
    image_path: Any,

) -> Dict[str, Any]:
    del pool
    if not image_path:
        return {"error": "invalid_params", "details": "image_path is required"}

    file_path = str(image_path)

    if not os.path.isfile(file_path):
        return {"error": "not_found", "details": f"No file found at {file_path}"}

    if pytesseract is None or Image is None:
        return {
            "error": "ocr_unavailable",
            "details": "pytesseract and Pillow must be installed to analyze images",
        }

    try:
        with Image.open(file_path) as pil_image:
            gray = pil_image.convert("L")
            text = pytesseract.image_to_string(gray)
    except Exception as exc:
        return {"error": "ocr_failed", "details": repr(exc)}

    match = _extract_account_match(text)
    amount = _extract_currency_amount(text)
    created = _extract_created_timestamp(text)
    result = {"match": match, "text": text}
    if amount:
        result["amount"] = amount
    if created:
        result["created"] = created
    return result

def _handle_get_app_user(pool: ConnectionPool, params: Sequence[Any]) -> Dict[str, Any]:
    if len(params) != 1:
        return {"error": "invalid_params", "details": "get_app_user expects exactly 1 parameter"}
    username = params[0]
    return get_app_user(pool, username)


def _handle_get_app_users(pool: ConnectionPool, params: Sequence[Any]) -> Dict[str, Any]:
    if len(params) > 1:
        return {
            "error": "invalid_params",
            "details": "get_app_users accepts at most 1 parameter",
        }

    user_type = params[0] if params else "user"
    return get_app_users_by_type(pool, user_type)


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

def _handle_resumen_remitos(
    pool: ConnectionPool,
    params: Sequence[Any],

) -> Dict[str, Any]:
    if params:
        return {
            "error": "invalid_params",
            "details": "resumen_remitos does not accept parameters",
        }
    return resumen_remitos(pool)


def _handle_traer_resumen_prestamos(
    pool: ConnectionPool,
    params: Sequence[Any],

) -> Dict[str, Any]:
    if params:
        return {
            "error": "invalid_params",
            "details": "traer_resumen_prestamos does not accept parameters",
        }
    return traer_resumen_prestamos(pool)

def _handle_traer_facturas_atrasadas(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if params:
        return {
            "error": "invalid_params",
            "details": "traer_facturas_atrasadas does not accept parameters",
        }
    return traer_facturas_atrasadas(pool)

def _handle_traer_ignorar(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if params:
        return {
            "error": "invalid_params",
            "details": "traer_ignorar does not accept parameters",
        }
    return traer_ignorar(pool)

def _handle_traer_movimientos_cliente(
    pool: ConnectionPool,
    params: Sequence[Any],

) -> Dict[str, Any]:
    if not params:
        return {
            "error": "invalid_params",
            "details": "traer_movimientos_cliente expects at least cod_cliente",
        }
    if len(params) == 1:
        return traer_movimientos_cliente(pool, params[0])
    if len(params) == 2:
        return traer_movimientos_cliente(pool, params[0], params[1])
    return {
        "error": "invalid_params",
        "details": "traer_movimientos_cliente accepts at most cod_cliente and subcodigo",
    }


def _handle_actualizar_infoextra_por_registro(
    pool: ConnectionPool,
    params: Sequence[Any],

) -> Dict[str, Any]:
    if len(params) != 5:
        return {
            "error": "invalid_params",
            "details": (
                "actualizar_infoextra_por_registro expects "
                "numero_remito, prefijo_remito, tipo_comprobante, nro_orden and INFOEXTRA"
            ),
        }
    return actualizar_infoextra_por_registro(
        pool,
        params[0],
        params[1],
        params[2],
        params[3],
        params[4],
    )

def _handle_actualizar_nuevo_stock(
    pool: ConnectionPool,
    params: Sequence[Any],

) -> Dict[str, Any]:
    if len(params) != 5:
        return {
            "error": "invalid_params",
            "details": (
                "actualizar_nuevo_stock expects tipo_comprobante, prefijo_remito, "
                "numero_remito, nro_orden and nuevo_stock"
            ),
        }
    return actualizar_nuevo_stock(
        pool,
        params[0],
        params[1],
        params[2],
        params[3],
        params[4],
    )


def _handle_update_user_permissions(
    pool: ConnectionPool,
    params: Sequence[Any],

) -> Dict[str, Any]:
    if len(params) != 2:
        return {
            "error": "invalid_params",
            "details": "update_user_permissions expects user_id and permissions map",
        }

    user_id = params[0]
    permissions = params[1]
    if not isinstance(permissions, dict):
        return {
            "error": "invalid_params",
            "details": "permissions must be an object",
        }

    return update_user_permissions(pool, user_id, permissions)


def _handle_ingresar_registro_hoja_de_ruta(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 4:
        return {
            "error": "invalid_params",
            "details": "ingresar_registro_hoja_de_ruta expects motivo, detalle, recorrido and fecha_recorrido",
        }

    return ingresar_registro_hoja_de_ruta(pool, params[0], params[1], params[2], params[3])


def _handle_traer_hoja_de_ruta_por_dia(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 1:
        return {
            "error": "invalid_params",
            "details": "traer_hoja_de_ruta_por_dia expects dia_recorrido",
        }

    return traer_hoja_de_ruta_por_dia(pool, params[0])


def _handle_traer_hoja_de_ruta(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 0:
        return {
            "error": "invalid_params",
            "details": "traer_hoja_de_ruta does not accept parameters",
        }

    return traer_hoja_de_ruta(pool)

def _handle_insertar_envases_en_hoja_de_ruta(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 0:
        return {
            "error": "invalid_params",
            "details": "insertar_envases_en_hoja_de_ruta does not accept parameters",
        }
    return insertar_envases_en_hoja_de_ruta(pool)

def _handle_editar_registro_hdr(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 5:
        return {
            "error": "invalid_params",
            "details": "editar_registro_hdr expects motivo, detalle, nuevo_detalle, recorrido and fechas_recorrido",
        }
    return editar_registro_hdr(pool, params[0], params[1], params[2], params[3], params[4])


def _handle_analyze_upload_image(
    pool: ConnectionPool,
    params: Sequence[Any],

) -> Dict[str, Any]:
    if len(params) != 1:
        return {
            "error": "invalid_params",
            "details": "analyze_upload_image expects the image path as its only parameter",
        }
    return analyze_upload_image(pool, params[0])

COMMAND_HANDLERS: Dict[str, Callable[[ConnectionPool, Sequence[Any]], Dict[str, Any]]] = {
    "get_app_user": _handle_get_app_user,
    "get_app_users": _handle_get_app_users,
    "get_clientes": _handle_get_clientes,
    "update_cliente": _handle_update_cliente,
    "modificar_cobros_impagos": _handle_modificar_cobros_impagos,
    "traer_incongruencias": _handle_traer_incongruencias,
    "resumen_remitos": _handle_resumen_remitos,
    "traer_resumen_prestamos": _handle_traer_resumen_prestamos,
    "traer_facturas_atrasadas": _handle_traer_facturas_atrasadas,
    "traer_ignorar": _handle_traer_ignorar,
    "traer_movimientos_cliente": _handle_traer_movimientos_cliente,
    "actualizar_infoextra_por_registro": _handle_actualizar_infoextra_por_registro,
    "actualizar_nuevo_stock": _handle_actualizar_nuevo_stock,
    "update_user_permissions": _handle_update_user_permissions,
    "analyze_upload_image": _handle_analyze_upload_image,
    "ingresar_registro_hoja_de_ruta": _handle_ingresar_registro_hoja_de_ruta,
    "traer_hoja_de_ruta_por_dia": _handle_traer_hoja_de_ruta_por_dia,
    "traer_hoja_de_ruta": _handle_traer_hoja_de_ruta,
    "insertar_envases_en_hoja_de_ruta": _handle_insertar_envases_en_hoja_de_ruta,
    "editar_registro_hdr": _handle_editar_registro_hdr,

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
