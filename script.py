import json
import os
import re
import signal
import shutil
import sys
from datetime import date, datetime
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import pyodbc

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = None  # type: ignore
    ImageOps = None  # type: ignore

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
        configured_path = os.environ.get("PATNAV_TESSERACT_CMD")
        if configured_path:
            return configured_path

        if sys.platform.startswith("win"):
            for base_dir in _RESOURCE_ROOTS:
                candidate = os.path.join(base_dir, "Tesseract", "tesseract.exe")
                if os.path.isfile(candidate):
                    return candidate
            return os.path.join(_RESOURCE_ROOTS[0], "Tesseract", "tesseract.exe")

        return shutil.which("tesseract") or "tesseract"

    TESS_PATH = _resolve_tesseract_path()
    pytesseract.pytesseract.tesseract_cmd = TESS_PATH
    tess_dir = os.path.dirname(TESS_PATH)
    current_path = os.environ.get("PATH", "")
    if tess_dir and tess_dir not in current_path.split(os.pathsep):
        os.environ["PATH"] = tess_dir + (os.pathsep + current_path if current_path else "")
    tessdata_dir = os.path.join(tess_dir, "tessdata") if tess_dir else ""
    if tessdata_dir and os.path.isdir(tessdata_dir):
        os.environ.setdefault("TESSDATA_PREFIX", tessdata_dir)
except ImportError:
    pytesseract = None  # type: ignore

def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value else default

def _env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default

def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}

SERVER = _env_str("PATNAV_DB_SERVER", "192.168.100.138,1433")

DATABASE = _env_str("PATNAV_DB_DATABASE", "NAVIERA")

DRIVER = _env_str("PATNAV_DB_DRIVER", "ODBC Driver 18 for SQL Server")

USE_WINDOWS_AUTH = _env_bool("PATNAV_DB_WINDOWS_AUTH", False)

SQL_USER = _env_str("PATNAV_DB_USER", "navexe")

SQL_PASS = _env_str("PATNAV_DB_PASS", "navexe1433")

CONNECT_TIMEOUT = _env_int("PATNAV_DB_CONNECT_TIMEOUT", 10)

POOL_SIZE = _env_int("PATNAV_DB_POOL_SIZE", 1)

CURRENCY_PATTERN = re.compile(r'\$\s*([0-9][0-9. ,]*)')
ACCOUNT_PATTERN = re.compile(
    r'\b(C[VB]U)\b\s*[:=\-.]?\s*([0-9A-ZIlOo|.\-\s]{10,48})',
    re.IGNORECASE,
)
CREATED_PATTERN = re.compile(
    r"creada\s+el\s+(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s*[-–]\s*([0-9]{1,2}:[0-9]{2})",
    re.IGNORECASE
)
DISPLAYED_DATE_PATTERN = re.compile(
    r"\b(\d{1,2})\s*/\s*([a-záéíóúñ]{3,10})\.?\s*[-–]\s*([0-9]{1,2}:[0-9]{2})(?:\s*(?:hs?|hrs?))?",
    re.IGNORECASE,
)
ACCOUNT_DIGIT_TRANSLATION = str.maketrans({
    "O": "0",
    "o": "0",
    "I": "1",
    "l": "1",
    "|": "1",
    "B": "8",
    "S": "5",
})
MONTH_MAP = {
    "ene": 1,
    "enero": 1,
    "feb": 2,
    "febrero": 2,
    "mar": 3,
    "marzo": 3,
    "abr": 4,
    "abril": 4,
    "may": 5,
    "mayo": 5,
    "jun": 6,
    "junio": 6,
    "jul": 7,
    "julio": 7,
    "ago": 8,
    "agosto": 8,
    "sep": 9,
    "set": 9,
    "sept": 9,
    "septiembre": 9,
    "setiembre": 9,
    "oct": 10,
    "octubre": 10,
    "nov": 11,
    "noviembre": 11,
    "november": 11,
    "dic": 12,
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
    View5 = 1 if bool(permissions.get("View5")) else 0

    result = run_procedure(
        pool,
        "{CALL update_user_permission (?, ?, ?, ?, ?, ?)}",
        (parsed_user_id, test_view, test_view2, View3, View4, View5),
    )

    if result.get("error") == "db_execute_failed":
        details = str(result.get("details", "")).lower()
        if "too many" in details or "arguments" in details:
            result = run_procedure(
                pool,
                "{CALL update_user_permission (?, ?, ?, ?, ?)}",
                (parsed_user_id, test_view, test_view2, View3, View4),
            )
            if result.get("error") != "db_execute_failed":
                return result

            details = str(result.get("details", "")).lower()
            if "too many" in details or "arguments" in details:
                return run_procedure(
                    pool,
                    "{CALL update_user_permission (?, ?, ?, ?)}",
                    (parsed_user_id, test_view, test_view2, View3),
                )

    return result


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _validate_required_text(
    value: Any,
    field_name: str,
    max_len: int,
    empty_message: Optional[str] = None,
) -> Tuple[Optional[str], Optional[Dict[str, str]]]:
    if value is None:
        return None, {"error": "invalid_params", "details": f"{field_name} is required"}
    normalized = _normalize_text(value)
    if not normalized:
        detail = empty_message or f"{field_name} is required"
        return None, {"error": "invalid_params", "details": detail}
    if max_len and len(normalized) > max_len:
        return None, {
            "error": "invalid_params",
            "details": f"{field_name} must be {max_len} characters or fewer",
        }
    return normalized, None


def _parse_date_value(
    value: Any,
    field_name: str,
) -> Tuple[Optional[date], Optional[Dict[str, str]]]:
    try:
        if isinstance(value, datetime):
            return value.date(), None
        if isinstance(value, date):
            return value, None
        if value is None:
            raise TypeError("missing")
        raw = str(value).strip()
        return datetime.strptime(raw, "%Y-%m-%d").date(), None
    except (TypeError, ValueError):
        return None, {
            "error": "invalid_params",
            "details": f"{field_name} must be a date in YYYY-MM-DD format",
        }


def ingresar_registro_hoja_de_ruta(
    pool: ConnectionPool,
    motivo: Any,
    detalle: Any,
    recorrido: Any,
    fecha_recorrido: Any,
) -> Dict[str, Any]:
    if motivo is None or detalle is None or recorrido is None or fecha_recorrido is None:
        return {"error": "invalid_params", "details": "All fields are required"}

    motivo_value, error = _validate_required_text(motivo, "motivo", 15)
    if error:
        return error

    detalle_value, error = _validate_required_text(detalle, "detalle", 100)
    if error:
        return error

    recorrido_value, error = _validate_required_text(recorrido, "recorrido", 4)
    if error:
        return error

    fecha_value, error = _parse_date_value(fecha_recorrido, "fecha_recorrido")
    if error:
        return error

    fecha_recorrido_value = fecha_value.isoformat()
    fecha_ingreso_value = date.today().isoformat()
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

def insertar_mensajes_lote_por_lote(pool: ConnectionPool, nro_lote: Any) -> Dict[str, Any]:
    try:
        nro_value = int(nro_lote)
    except (TypeError, ValueError):
        return {"error": "invalid_params", "details": "nro_lote must be an integer"}

    return run_procedure(
        pool,
        "EXEC InsertarMensajesLotePorLote @nro_lote=?",
        (nro_value,),
    )

def editar_registro_hdr(
    pool: ConnectionPool,
    motivo: Any,
    detalle: Any,
    nuevo_detalle: Any,
    recorrido: Any,
    fechas_recorrido: Any,
) -> Dict[str, Any]:
    motivo_value, error = _validate_required_text(motivo, "motivo", 15)
    if error:
        return error

    detalle_value, error = _validate_required_text(detalle, "detalle", 100)
    if error:
        return error

    nuevo_detalle_value, error = _validate_required_text(
        nuevo_detalle,
        "nuevo_detalle",
        100,
        empty_message="nuevo_detalle cannot be empty",
    )
    if error:
        return error

    recorrido_value, error = _validate_required_text(recorrido, "recorrido", 4)
    if error:
        return error

    fecha_value, error = _parse_date_value(fechas_recorrido, "fechas_recorrido")
    if error:
        return error

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
        tokens = cleaned.split()
    lowered = cleaned.lower()
    blocked_terms = (
        "banco",
        "cbu",
        "cvu",
        "coelsa",
        "destino",
        "dinero",
        "disponible",
        "galicia",
        "mercado pago",
        "origen",
    )
    if len(tokens) < 2 or any(term in lowered for term in blocked_terms):
        return ""
    return cleaned


def _extract_currency_amount(text: str) -> Optional[str]:
    if not text:
        return None
    for match in CURRENCY_PATTERN.finditer(text):
        raw = match.group(1)
        cleaned = re.sub(r"\s+", "", raw)
        if cleaned:
            return cleaned
    return None


def _normalize_account_digits(value: str) -> str:
    translated = value.translate(ACCOUNT_DIGIT_TRANSLATION)
    return re.sub(r"\D", "", translated)


def _score_account_digits(digits: str) -> int:
    length = len(digits)
    if length < 22:
        return -1000
    if length == 22:
        return 120
    if length > 22:
        return 90 - min(length - 22, 20)
    return -1000


def _extract_account_match(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None

    candidates: List[Tuple[int, int, Dict[str, Any]]] = []
    previous_line = ""
    candidate_index = 0
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        for match in ACCOUNT_PATTERN.finditer(line):
            account_type = match.group(1).upper().replace(" ", "")
            raw_digits = match.group(2)
            digits = _normalize_account_digits(raw_digits)
            score = _score_account_digits(digits)
            if score <= 0:
                continue

            if len(digits) > 22:
                digits = digits[:22]

            normalized_type = "CVU" if account_type.startswith("CV") else "CBU"
            holder = _clean_holder_value(previous_line)
            holder_value = holder or None
            candidate = {"type": normalized_type, "number": digits, "holder": holder_value}
            candidates.append((score, -candidate_index, candidate))
            candidate_index += 1

        previous_line = line

    if not candidates:
        return None

    return max(candidates, key=lambda item: (item[0], item[1]))[2]


def _infer_transfer_year(day_number: int, month: int) -> int:
    today = date.today()
    inferred_year = today.year
    try:
        candidate_date = date(inferred_year, month, day_number)
    except ValueError:
        return inferred_year
    if candidate_date > today:
        return inferred_year - 1
    return inferred_year


def _format_ocr_timestamp(day: str, month_name: str, time_value: str) -> Optional[str]:
    month = MONTH_MAP.get(month_name.strip().lower())
    if not month:
        return None
    day_number = int(day)
    year = _infer_transfer_year(day_number, month)
    formatted_date = f"{day_number:02d}/{month:02d}/{year}"
    return f"{formatted_date} - {time_value}"


def _extract_created_timestamp(text: str) -> Optional[str]:
    if not text:
        return None

    for pattern in (DISPLAYED_DATE_PATTERN, CREATED_PATTERN):
        for match in pattern.finditer(text):
            formatted = _format_ocr_timestamp(match.group(1), match.group(2), match.group(3))
            if formatted:
                return formatted

    return None


def _autocontrast_image(image: Any) -> Any:
    if ImageOps is None:
        return image
    return ImageOps.autocontrast(image)


def _scale_image(image: Any, factor: int) -> Any:
    width, height = image.size
    return image.resize((width * factor, height * factor))


def _crop_by_ratio(image: Any, left: float, top: float, right: float, bottom: float) -> Any:
    width, height = image.size
    box = (
        int(width * left),
        int(height * top),
        int(width * right),
        int(height * bottom),
    )
    return image.crop(box)


def _build_ocr_attempts(pil_image: Any) -> List[Tuple[str, Any, str]]:
    base = pil_image.convert("RGB")
    gray = base.convert("L")
    scaled = _autocontrast_image(_scale_image(gray, 2))
    top_region = _crop_by_ratio(base, 0.05, 0.05, 0.70, 0.30).convert("L")
    account_region = _crop_by_ratio(base, 0.05, 0.33, 0.78, 0.56).convert("L")

    return [
        ("full_scaled_layout", scaled, "--psm 6"),
        ("full_default", gray, ""),
        ("full_scaled_sparse", scaled, "--psm 11"),
        ("top_scaled", _autocontrast_image(_scale_image(top_region, 3)), "--psm 6"),
        ("account_scaled", _autocontrast_image(_scale_image(account_region, 3)), "--psm 6"),
    ]


def _read_ocr_text(pil_image: Any) -> str:
    texts: List[str] = []
    seen = set()
    errors: List[str] = []

    for name, image, config in _build_ocr_attempts(pil_image):
        try:
            text = pytesseract.image_to_string(image, config=config).strip()
        except Exception as exc:
            errors.append(f"{name}: {exc!r}")
            continue

        if text and text not in seen:
            texts.append(text)
            seen.add(text)

    if texts:
        return "\n\n".join(texts)

    details = "; ".join(errors) if errors else "OCR did not return text"
    raise RuntimeError(details)


def analyze_upload_image(
    _pool: ConnectionPool,
    image_path: Any,

) -> Dict[str, Any]:
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
            text = _read_ocr_text(pil_image)
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

def _handle_insertar_mensajes_lote_por_lote(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 1:
        return {
            "error": "invalid_params",
            "details": "insertar_mensajes_lote_por_lote expects nro_lote",
        }
    return insertar_mensajes_lote_por_lote(pool, params[0])

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
    "insertar_mensajes_lote_por_lote": _handle_insertar_mensajes_lote_por_lote,
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
    pool = ConnectionPool(size=POOL_SIZE)
    def _cleanup(*_args: Any) -> None:
        sys.exit(0)
    signal.signal(signal.SIGINT, _cleanup)
    signal.signal(signal.SIGTERM, _cleanup)
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            cmd = None
            params: Sequence[Any] = []
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                cmd = line
            else:
                if isinstance(payload, dict):
                    cmd = payload.get("cmd")
                    params = _normalize_params(payload.get("params"))
                elif isinstance(payload, str):
                    cmd = payload
                else:
                    res = {
                        "error": "invalid_params",
                        "details": "payload must be an object or string",
                    }
                    print(json.dumps(res, default=str))
                    sys.stdout.flush()
                    continue
            if cmd == "exit":
                break
            if not cmd:
                res = {"error": "missing_command"}
            else:
                res = _dispatch(pool, cmd, params)
            print(json.dumps(res, default=str))
            sys.stdout.flush()
    finally:
        pool.close()

if __name__ == "__main__":
    main()
