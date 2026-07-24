import json
import os
import re
import signal
import shutil
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import pyodbc

from comprobante_ocr import (
    merge_ocr_attempts,
    normalize_account_digits,
    ocr_data_to_lines,
    parse_amount,
    parse_mercado_pago_text,
)

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

OCR_LANGUAGE = _env_str("PATNAV_OCR_LANGUAGE", "eng")

OCR_TIMEOUT_SECONDS = _env_int("PATNAV_OCR_TIMEOUT_SECONDS", 12)

OCR_MAX_IMAGE_BYTES = _env_int("PATNAV_OCR_MAX_IMAGE_BYTES", 10 * 1024 * 1024)

OCR_MAX_IMAGE_PIXELS = _env_int("PATNAV_OCR_MAX_IMAGE_PIXELS", 20_000_000)

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
    View6 = 1 if bool(permissions.get("View6")) else 0
    View7 = 1 if bool(permissions.get("View7")) else 0
    View8 = 1 if bool(permissions.get("View8")) else 0

    result = run_procedure(
        pool,
        "{CALL update_user_permission (?, ?, ?, ?, ?, ?, ?, ?, ?)}",
        (parsed_user_id, test_view, test_view2, View3, View4, View5, View6, View7, View8),
    )

    if result.get("error") == "db_execute_failed":
        details = str(result.get("details", "")).lower()
        if "too many" in details or "arguments" in details:
            result = run_procedure(
                pool,
                "{CALL update_user_permission (?, ?, ?, ?, ?, ?, ?, ?)}",
                (parsed_user_id, test_view, test_view2, View3, View4, View5, View6, View7),
            )
            if result.get("error") != "db_execute_failed":
                return result

            details = str(result.get("details", "")).lower()
            if "too many" in details or "arguments" in details:
                result = run_procedure(
                    pool,
                    "{CALL update_user_permission (?, ?, ?, ?, ?, ?, ?)}",
                    (parsed_user_id, test_view, test_view2, View3, View4, View5, View6),
                )
                if result.get("error") != "db_execute_failed":
                    return result

                details = str(result.get("details", "")).lower()
                if "too many" in details or "arguments" in details:
                    result = run_procedure(
                        pool,
                        "{CALL update_user_permission (?, ?, ?, ?, ?, ?)}",
                        (parsed_user_id, test_view, test_view2, View3, View4, View5),
                    )
                    if result.get("error") != "db_execute_failed":
                        return result

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


def _autocontrast_image(image: Any) -> Any:
    if ImageOps is None:
        return image
    return ImageOps.autocontrast(image)


def _scale_image(image: Any, factor: int) -> Any:
    width, height = image.size
    resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
    return image.resize((width * factor, height * factor), resampling)


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


def _read_ocr_attempts(pil_image: Any) -> List[Dict[str, Any]]:
    attempts: List[Dict[str, Any]] = []
    errors: List[str] = []

    for name, image, config in _build_ocr_attempts(pil_image):
        try:
            ocr_data = pytesseract.image_to_data(
                image,
                lang=OCR_LANGUAGE,
                config=f"--oem 3 {config}".strip(),
                output_type=pytesseract.Output.DICT,
                timeout=OCR_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            errors.append(f"{name}: {exc!r}")
            continue

        lines = ocr_data_to_lines(ocr_data)
        text = "\n".join(str(line["text"]) for line in lines).strip()
        if text:
            attempts.append({"name": name, "text": text, "lines": lines})

    if attempts:
        return attempts

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

    try:
        file_size = os.path.getsize(file_path)
    except OSError as exc:
        return {"error": "unreadable_image", "details": repr(exc)}

    if file_size <= 0:
        return {"error": "invalid_image", "details": "The image file is empty"}

    if file_size > OCR_MAX_IMAGE_BYTES:
        return {
            "error": "image_too_large",
            "details": f"The image exceeds the {OCR_MAX_IMAGE_BYTES} byte limit",
        }

    if pytesseract is None or Image is None:
        return {
            "error": "ocr_unavailable",
            "details": "pytesseract and Pillow must be installed to analyze images",
        }

    try:
        Image.MAX_IMAGE_PIXELS = OCR_MAX_IMAGE_PIXELS
        with Image.open(file_path) as pil_image:
            image_format = pil_image.format
            if image_format not in {"PNG", "JPEG"}:
                return {
                    "error": "unsupported_image_type",
                    "details": "Only PNG and JPG/JPEG receipts are supported",
                }
            pil_image.load()
            attempts = _read_ocr_attempts(pil_image)
    except Exception as exc:
        return {"error": "ocr_failed", "details": repr(exc)}

    parsed = merge_ocr_attempts(attempts)
    fields = parsed["fields"]
    account = fields["account"]
    payer = fields["payer_name"]
    amount = fields["amount"]
    payment_date = fields["payment_date"]

    match = None
    if account.get("value"):
        match = {
            "type": account.get("type"),
            "number": account["value"],
            "holder": payer.get("value"),
        }

    try:
        ocr_version = str(pytesseract.get_tesseract_version())
    except Exception:
        ocr_version = None

    result = {
        "ok": True,
        "scanner": "mercado_pago_comprobante",
        "match": match,
        "amount": amount.get("value"),
        "created": payment_date.get("display"),
        "fields": fields,
        "missing_fields": parsed["missing_fields"],
        "warnings": parsed["warnings"],
        "text": parsed.get("text", ""),
        "ocr": {
            "engine": "tesseract",
            "version": ocr_version,
            "language": OCR_LANGUAGE,
            "average_confidence": parsed.get("average_confidence"),
            "selected_attempt": parsed.get("ocr_attempt"),
            "attempts": parsed.get("attempts", []),
        },
        "file": {
            "path": file_path,
            "size_bytes": file_size,
            "detected_format": image_format,
        },
    }
    return result


def mark_upload_processed(image_path: Any) -> Dict[str, Any]:
    if not image_path:
        return {"error": "invalid_params", "details": "image_path is required"}

    file_path = str(image_path)
    if not os.path.isfile(file_path):
        return {"error": "not_found", "details": f"No file found at {file_path}"}

    try:
        os.remove(file_path)
    except OSError as exc:
        return {"error": "delete_failed", "details": str(exc)}

    return {
        "status": "processed",
        "file_path": file_path,
        "file_name": os.path.basename(file_path),
        "deleted": True,
    }


def _serialize_transfer_row(columns: Sequence[str], row: Sequence[Any]) -> Dict[str, Any]:
    result = dict(zip(columns, row))
    fecha = result.get("fecha")
    if isinstance(fecha, datetime):
        result["fecha"] = fecha.isoformat(timespec="seconds")
        result["fecha_display"] = fecha.strftime("%d/%m/%Y - %H:%M")
    monto = result.get("monto")
    if isinstance(monto, Decimal):
        result["monto"] = str(monto)
    return result


def _serialize_db_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _serialize_db_row(columns: Sequence[str], row: Sequence[Any]) -> Dict[str, Any]:
    return {
        column: _serialize_db_value(value)
        for column, value in zip(columns, row)
    }


def _quote_identifier(identifier: str) -> str:
    return "[" + identifier.replace("]", "]]") + "]"


def _get_table_columns(cursor: 'pyodbc.Cursor', table_name: str) -> Dict[str, str]:
    cursor.execute(
        """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = ?;
        """,
        (table_name,),
    )
    return {str(row[0]).lower(): str(row[0]) for row in cursor.fetchall()}


def _pick_column(columns: Dict[str, str], *candidates: str) -> Optional[str]:
    for candidate in candidates:
        match = columns.get(candidate.lower())
        if match:
            return match
    return None


def _select_column(
    table_alias: str,
    columns: Dict[str, str],
    alias: str,
    *candidates: str,
) -> str:
    column = _pick_column(columns, *candidates)
    if not column:
        return f"CAST(NULL AS nvarchar(max)) AS {_quote_identifier(alias)}"
    return f"{table_alias}.{_quote_identifier(column)} AS {_quote_identifier(alias)}"


def _column_ref(
    table_alias: str,
    columns: Dict[str, str],
    required_alias: str,
    *candidates: str,
) -> str:
    column = _pick_column(columns, *candidates)
    if not column:
        raise ValueError(f"Missing required column {required_alias}")
    return f"{table_alias}.{_quote_identifier(column)}"


def _to_int_range_value(value: Any, field_name: str) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer.") from exc
    if parsed <= 0:
        raise ValueError(f"{field_name} must be greater than zero.")
    return parsed


def traer_facultad_facturas(
    pool: ConnectionPool,
    desde: Any,
    hasta: Any,
) -> Dict[str, Any]:
    try:
        desde_numero = _to_int_range_value(desde, "desde")
        hasta_numero = _to_int_range_value(hasta, "hasta")
    except ValueError as exc:
        return {"error": "invalid_params", "details": str(exc)}

    if desde_numero > hasta_numero:
        return {
            "error": "invalid_params",
            "details": "desde must be less than or equal to hasta.",
        }

    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET LOCK_TIMEOUT 5000;")

        ventas_columns = _get_table_columns(cursor, "Ventas")
        ventas_items_columns = _get_table_columns(cursor, "VentasItems")
        cliente_columns = _get_table_columns(cursor, "Cliente")
        item_columns = _get_table_columns(cursor, "Item")
        categoria_iva_columns = _get_table_columns(cursor, "CategoriaIva")

        ventas_tipo = _column_ref("v", ventas_columns, "tipo_comprobante", "tipo_comprobante")
        ventas_prefijo = _column_ref("v", ventas_columns, "prefijo", "prefijo")
        ventas_numero = _column_ref("v", ventas_columns, "numero", "numero")
        ventas_cod_cliente = _column_ref("v", ventas_columns, "cod_cliente", "cod_cliente")
        cliente_cod_cliente = _column_ref("c", cliente_columns, "cod_cliente", "cod_cliente")
        cliente_cod_categoria = _column_ref("c", cliente_columns, "cod_categoria", "cod_categoria")
        categoria_cod_categoria = _column_ref("ci", categoria_iva_columns, "cod_categoria", "cod_categoria")

        cursor.execute(
            f"""
            SELECT
                LTRIM(RTRIM({ventas_tipo})) AS tipo_comprobante,
                {ventas_prefijo} AS prefijo,
                {ventas_numero} AS numero,
                {ventas_cod_cliente} AS cod_cliente,
                {_select_column("v", ventas_columns, "fecha_operacion", "fecha_operacion", "fecha", "fecha_emision")},
                {_select_column("v", ventas_columns, "remitos_facturados", "remitos_facturados", "remitos", "remitos_fac")},
                {_select_column("v", ventas_columns, "cae", "cae", "CAE")},
                {_select_column("v", ventas_columns, "fecha_vencimiento_cae", "fecha_vencimiento_cae", "fecha_vencimiento_cae", "fecha_vto_cae", "vencimiento_cae")},
                {_select_column("c", cliente_columns, "razon_social", "razon_social")},
                {_select_column("c", cliente_columns, "dom_fiscal1", "dom_fiscal1", "dom_fiscal")},
                {_select_column("c", cliente_columns, "cod_categoria", "cod_categoria")},
                {_select_column("c", cliente_columns, "cuit", "cuit")},
                {_select_column("ci", categoria_iva_columns, "categoria", "categoria")}
            FROM dbo.Ventas AS v
            LEFT JOIN dbo.Cliente AS c
                ON {cliente_cod_cliente} = {ventas_cod_cliente}
            LEFT JOIN dbo.CategoriaIva AS ci
                ON {categoria_cod_categoria} = {cliente_cod_categoria}
            WHERE LTRIM(RTRIM({ventas_tipo})) = 'FB'
              AND {ventas_prefijo} = 7
              AND {ventas_numero} BETWEEN ? AND ?
            ORDER BY {ventas_numero};
            """,
            (desde_numero, hasta_numero),
        )
        columns = [column[0] for column in cursor.description]
        venta_rows = [
            _serialize_db_row(columns, row)
            for row in cursor.fetchall()
        ]

        items_by_key: Dict[Tuple[str, int, int], List[Dict[str, Any]]] = {}
        if venta_rows:
            items_tipo = _column_ref("vi", ventas_items_columns, "tipo_comprobante", "tipo_comprobante")
            items_prefijo = _column_ref("vi", ventas_items_columns, "prefijo", "prefijo")
            items_numero = _column_ref("vi", ventas_items_columns, "numero", "numero")
            items_cod_item = _column_ref("vi", ventas_items_columns, "cod_item", "cod_item")
            item_cod_item = _column_ref("i", item_columns, "cod_item", "cod_item")
            order_column = _pick_column(ventas_items_columns, "nro_orden", "orden")
            order_expression = (
                f", vi.{_quote_identifier(order_column)} AS nro_orden"
                if order_column
                else ", CAST(NULL AS int) AS nro_orden"
            )
            order_by_expression = (
                f"vi.{_quote_identifier(order_column)}, "
                if order_column
                else ""
            )

            cursor.execute(
                f"""
                SELECT
                    LTRIM(RTRIM({items_tipo})) AS tipo_comprobante,
                    {items_prefijo} AS prefijo,
                    {items_numero} AS numero
                    {order_expression},
                    {_select_column("vi", ventas_items_columns, "cantidad", "cantidad")},
                    {items_cod_item} AS cod_item,
                    {_select_column("vi", ventas_items_columns, "precio", "precio", "precio_unitario")},
                    {_select_column("vi", ventas_items_columns, "importe", "importe")},
                    {_select_column("i", item_columns, "denominacion", "denominacion", "descripcion")}
                FROM dbo.VentasItems AS vi
                LEFT JOIN dbo.Item AS i
                    ON {item_cod_item} = {items_cod_item}
                WHERE LTRIM(RTRIM({items_tipo})) = 'FB'
                  AND {items_prefijo} = 7
                  AND {items_numero} BETWEEN ? AND ?
                ORDER BY {items_numero}, {order_by_expression}{items_cod_item};
                """,
                (desde_numero, hasta_numero),
            )
            item_columns_result = [column[0] for column in cursor.description]
            for row in cursor.fetchall():
                item = _serialize_db_row(item_columns_result, row)
                key = (
                    str(item.get("tipo_comprobante") or "").strip(),
                    int(item.get("prefijo") or 0),
                    int(item.get("numero") or 0),
                )
                items_by_key.setdefault(key, []).append(item)

        invoices: List[Dict[str, Any]] = []
        for venta in venta_rows:
            key = (
                str(venta.get("tipo_comprobante") or "").strip(),
                int(venta.get("prefijo") or 0),
                int(venta.get("numero") or 0),
            )
            invoices.append(
                {
                    **venta,
                    "items": items_by_key.get(key, []),
                }
            )

        return {
            "columns": columns,
            "rows": invoices,
            "desde": desde_numero,
            "hasta": hasta_numero,
            "tipo_comprobante": "FB",
            "prefijo": 7,
        }
    except ValueError as exc:
        return {"error": "schema_error", "details": str(exc)}
    except pyodbc.Error as exc:
        pool.discard(conn)
        conn = None
        return {"error": "db_execute_failed", "details": str(exc)}
    finally:
        _close_cursor(cursor)
        pool.release(conn)


TRANSFER_TABLE_QUERIES = {
    "transferencias": {
        "label": "Transferencias",
        "pk": "id_transferencia",
        "list_sql": """
            SELECT TOP (500)
                id_transferencia,
                cvu_cbu,
                monto,
                id_usuario_transferencia,
                fecha,
                nombre_asociado,
                estado
            FROM dbo.Transferencias
            ORDER BY id_transferencia DESC;
        """,
        "delete_sql": "DELETE FROM dbo.Transferencias WHERE id_transferencia = ?;",
    },
    "usuarios_transferencia": {
        "label": "UsuariosTransferencia",
        "pk": "id_usuario_transferencia",
        "list_sql": """
            SELECT TOP (500)
                u.id_usuario_transferencia,
                u.cod_cliente,
                u.nro_lugar_entrega,
                u.cvu_cbu,
                u.orden,
                COUNT(t.id_transferencia) AS transferencias_asociadas
            FROM dbo.UsuariosTransferencia AS u
            LEFT JOIN dbo.Transferencias AS t
                ON t.id_usuario_transferencia = u.id_usuario_transferencia
            GROUP BY
                u.id_usuario_transferencia,
                u.cod_cliente,
                u.nro_lugar_entrega,
                u.cvu_cbu,
                u.orden
            ORDER BY u.id_usuario_transferencia DESC;
        """,
        "delete_sql": """
            DELETE FROM dbo.UsuariosTransferencia
            WHERE id_usuario_transferencia = ?
              AND NOT
              (
                  cod_cliente IS NULL
                  AND nro_lugar_entrega IS NULL
                  AND cvu_cbu IS NULL
                  AND orden = 0
              );
        """,
    },
}


def list_transfer_table(pool: ConnectionPool, table_name: Any) -> Dict[str, Any]:
    table_key = str(table_name or "").strip().lower()
    table_config = TRANSFER_TABLE_QUERIES.get(table_key)
    if table_config is None:
        return {
            "error": "invalid_params",
            "details": "Unknown transfer table.",
        }

    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET LOCK_TIMEOUT 5000;")
        cursor.execute(table_config["list_sql"])
        columns = [column[0] for column in cursor.description]
        rows = [
            _serialize_db_row(columns, row)
            for row in cursor.fetchall()
        ]
        return {
            "table": table_key,
            "label": table_config["label"],
            "primary_key": table_config["pk"],
            "columns": columns,
            "rows": rows,
        }
    except pyodbc.Error as exc:
        pool.discard(conn)
        conn = None
        return {"error": "db_execute_failed", "details": str(exc)}
    finally:
        _close_cursor(cursor)
        pool.release(conn)


def delete_transfer_table_row(
    pool: ConnectionPool,
    table_name: Any,
    row_id: Any,
) -> Dict[str, Any]:
    table_key = str(table_name or "").strip().lower()
    table_config = TRANSFER_TABLE_QUERIES.get(table_key)
    if table_config is None:
        return {
            "error": "invalid_params",
            "details": "Unknown transfer table.",
        }

    try:
        parsed_row_id = int(row_id)
    except (TypeError, ValueError):
        return {
            "error": "invalid_params",
            "details": "row id must be an integer.",
        }

    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET LOCK_TIMEOUT 5000;")
        cursor.execute(table_config["delete_sql"], (parsed_row_id,))
        deleted_count = cursor.rowcount if cursor.rowcount is not None else 0
        conn.commit()
        if deleted_count <= 0:
            return {
                "status": "not_deleted",
                "deleted": 0,
                "details": (
                    "No se elimino ninguna fila. Puede que no exista, sea el usuario sin identificar, "
                    "o este referenciada por otra tabla."
                ),
            }
        return {"status": "deleted", "deleted": deleted_count}
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


def add_usuario_transferencia(
    pool: ConnectionPool,
    payload: Any,
) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {
            "error": "invalid_params",
            "details": "payload must be an object.",
        }

    account_value = str(payload.get("cvuCbu") or payload.get("cvu_cbu") or "").strip()
    if not re.fullmatch(r"\d{22}", account_value):
        return {
            "error": "invalid_params",
            "details": "cvu_cbu must contain 22 digits.",
        }

    try:
        parsed_cod_cliente = int(payload.get("codCliente") or payload.get("cod_cliente"))
        parsed_nro_lugar = int(payload.get("nroLugarEntrega") or payload.get("nro_lugar_entrega"))
    except (TypeError, ValueError):
        return {
            "error": "invalid_params",
            "details": "cod_cliente and nro_lugar_entrega must be integers.",
        }

    requested_order = payload.get("orden")
    try:
        parsed_order = int(requested_order) if requested_order not in (None, "") else None
    except (TypeError, ValueError):
        return {
            "error": "invalid_params",
            "details": "orden must be an integer.",
        }

    if parsed_order is not None and parsed_order <= 0:
        return {
            "error": "invalid_params",
            "details": "orden must be greater than zero.",
        }

    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;")
        cursor.execute(
            """
            SELECT TOP (1) 1
            FROM dbo.LugarEntrega WITH (HOLDLOCK)
            WHERE cod_cliente = ?
              AND nro_lugar_entrega = ?;
            """,
            (parsed_cod_cliente, parsed_nro_lugar),
        )
        if cursor.fetchone() is None:
            conn.rollback()
            return {
                "error": "not_found",
                "details": "No existe ese cliente/lugar de entrega.",
            }

        if parsed_order is None:
            cursor.execute(
                """
                SELECT COALESCE(MAX(orden), 0) + 1
                FROM dbo.UsuariosTransferencia WITH (UPDLOCK, HOLDLOCK)
                WHERE cod_cliente = ?
                  AND nro_lugar_entrega = ?;
                """,
                (parsed_cod_cliente, parsed_nro_lugar),
            )
            parsed_order = int(cursor.fetchone()[0])
        else:
            cursor.execute(
                """
                SELECT TOP (1) 1
                FROM dbo.UsuariosTransferencia WITH (UPDLOCK, HOLDLOCK)
                WHERE cod_cliente = ?
                  AND nro_lugar_entrega = ?
                  AND orden = ?;
                """,
                (parsed_cod_cliente, parsed_nro_lugar, parsed_order),
            )
            if cursor.fetchone() is not None:
                conn.rollback()
                return {
                    "error": "duplicate_order",
                    "details": "Ese cliente/lugar ya tiene un usuario con ese orden.",
                }

        cursor.execute(
            """
            INSERT INTO dbo.UsuariosTransferencia
            (
                cod_cliente,
                nro_lugar_entrega,
                cvu_cbu,
                orden
            )
            OUTPUT
                INSERTED.id_usuario_transferencia,
                INSERTED.cod_cliente,
                INSERTED.nro_lugar_entrega,
                INSERTED.cvu_cbu,
                INSERTED.orden
            VALUES (?, ?, ?, ?);
            """,
            (
                parsed_cod_cliente,
                parsed_nro_lugar,
                account_value,
                parsed_order,
            ),
        )
        columns = [column[0] for column in cursor.description]
        inserted = _serialize_db_row(columns, cursor.fetchone())
        conn.commit()
        return {
            "status": "inserted",
            "row": inserted,
        }
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


def list_unidentified_transferencias(pool: ConnectionPool) -> Dict[str, Any]:
    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET LOCK_TIMEOUT 5000;")
        cursor.execute(
            """
            SELECT
                t.id_transferencia,
                t.cvu_cbu,
                t.monto,
                t.fecha,
                t.nombre_asociado,
                t.estado,
                t.id_usuario_transferencia,
                COUNT(*) OVER (PARTITION BY t.cvu_cbu) AS transferencias_mismo_cvu
            FROM dbo.Transferencias AS t
            INNER JOIN dbo.UsuariosTransferencia AS u
                ON u.id_usuario_transferencia = t.id_usuario_transferencia
            WHERE u.cod_cliente IS NULL
              AND u.nro_lugar_entrega IS NULL
              AND t.estado = 'NO-CARGADA'
            ORDER BY t.fecha DESC, t.id_transferencia DESC;
            """
        )
        columns = [column[0] for column in cursor.description]
        rows = [
            _serialize_transfer_row(columns, row)
            for row in cursor.fetchall()
        ]
        return {"columns": columns, "rows": rows}
    except pyodbc.Error as exc:
        pool.discard(conn)
        conn = None
        return {"error": "db_execute_failed", "details": str(exc)}
    finally:
        _close_cursor(cursor)
        pool.release(conn)


def list_identified_transferencias(pool: ConnectionPool) -> Dict[str, Any]:
    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET LOCK_TIMEOUT 5000;")
        cursor.execute(
            """
            SELECT
                t.id_transferencia,
                t.cvu_cbu,
                t.monto,
                t.fecha,
                t.nombre_asociado,
                t.estado,
                t.id_usuario_transferencia,
                u.cod_cliente,
                u.nro_lugar_entrega,
                u.orden,
                LTRIM(RTRIM(COALESCE(c.razon_social, ''))) AS razon_social,
                LTRIM(RTRIM(CONCAT(
                    COALESCE(NULLIF(LTRIM(RTRIM(ca.nombre)), ''), ''),
                    CASE
                        WHEN le.numeropuerta IS NULL OR le.numeropuerta = 0 THEN ''
                        ELSE CONCAT(' ', CONVERT(varchar(20), le.numeropuerta))
                    END,
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))), '') IS NULL THEN ''
                        ELSE CONCAT(' ', LTRIM(RTRIM(le.observ_domicilio)))
                    END,
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))), '') IS NULL THEN ''
                        ELSE CONCAT(' ', LTRIM(RTRIM(le.[2observ_domicilio])))
                    END,
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(COALESCE(m.nombre, ''))), '') IS NULL THEN ''
                        ELSE CONCAT(' - ', LTRIM(RTRIM(m.nombre)))
                    END
                ))) AS direccion,
                COUNT(*) OVER (PARTITION BY t.cvu_cbu) AS transferencias_mismo_cvu
            FROM dbo.Transferencias AS t
            INNER JOIN dbo.UsuariosTransferencia AS u
                ON u.id_usuario_transferencia = t.id_usuario_transferencia
            LEFT JOIN dbo.Cliente AS c
                ON c.cod_cliente = u.cod_cliente
            LEFT JOIN dbo.LugarEntrega AS le
                ON le.cod_cliente = u.cod_cliente
               AND le.nro_lugar_entrega = u.nro_lugar_entrega
            LEFT JOIN dbo.Calle AS ca
                ON ca.cod_municipio = le.cod_municipio
               AND ca.cod_calle = le.cod_calle
            LEFT JOIN dbo.Municipio AS m
                ON m.cod_municipio = le.cod_municipio
            WHERE u.cod_cliente IS NOT NULL
              AND u.nro_lugar_entrega IS NOT NULL
              AND t.estado = 'NO-CARGADA'
            ORDER BY t.fecha DESC, t.id_transferencia DESC;
            """
        )
        columns = [column[0] for column in cursor.description]
        rows = [
            _serialize_transfer_row(columns, row)
            for row in cursor.fetchall()
        ]
        return {"columns": columns, "rows": rows}
    except pyodbc.Error as exc:
        pool.discard(conn)
        conn = None
        return {"error": "db_execute_failed", "details": str(exc)}
    finally:
        _close_cursor(cursor)
        pool.release(conn)


def list_transfer_address_candidates(pool: ConnectionPool) -> Dict[str, Any]:
    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET LOCK_TIMEOUT 5000;")
        cursor.execute(
            """
            SELECT
                le.cod_cliente,
                le.nro_lugar_entrega,
                LTRIM(RTRIM(COALESCE(c.razon_social, ''))) AS razon_social,
                LTRIM(RTRIM(COALESCE(c.dom_fiscal1, ''))) AS domicilio_fiscal,
                LTRIM(RTRIM(COALESCE(ca.nombre, ''))) AS calle,
                le.numeropuerta,
                LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))) AS observ_domicilio,
                LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))) AS observ_domicilio_2,
                LTRIM(RTRIM(COALESCE(m.nombre, ''))) AS municipio,
                LTRIM(RTRIM(CONCAT(
                    COALESCE(NULLIF(LTRIM(RTRIM(ca.nombre)), ''), ''),
                    CASE
                        WHEN le.numeropuerta IS NULL OR le.numeropuerta = 0 THEN ''
                        ELSE CONCAT(' ', CONVERT(varchar(20), le.numeropuerta))
                    END,
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))), '') IS NULL THEN ''
                        ELSE CONCAT(' ', LTRIM(RTRIM(le.observ_domicilio)))
                    END,
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))), '') IS NULL THEN ''
                        ELSE CONCAT(' ', LTRIM(RTRIM(le.[2observ_domicilio])))
                    END,
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(COALESCE(m.nombre, ''))), '') IS NULL THEN ''
                        ELSE CONCAT(' - ', LTRIM(RTRIM(m.nombre)))
                    END
                ))) AS direccion
            FROM dbo.LugarEntrega AS le
            INNER JOIN dbo.Cliente AS c
                ON c.cod_cliente = le.cod_cliente
            LEFT JOIN dbo.Calle AS ca
                ON ca.cod_municipio = le.cod_municipio
               AND ca.cod_calle = le.cod_calle
            LEFT JOIN dbo.Municipio AS m
                ON m.cod_municipio = le.cod_municipio
            WHERE NULLIF(LTRIM(RTRIM(CONVERT(varchar(40), le.fecha_fin_contrato))), '') IS NULL
            ORDER BY direccion, razon_social, le.cod_cliente, le.nro_lugar_entrega;
            """
        )
        columns = [column[0] for column in cursor.description]
        rows = [
            _serialize_db_row(columns, row)
            for row in cursor.fetchall()
        ]
        return {"columns": columns, "rows": rows}
    except pyodbc.Error as exc:
        pool.discard(conn)
        conn = None
        return {"error": "db_execute_failed", "details": str(exc)}
    finally:
        _close_cursor(cursor)
        pool.release(conn)


def list_transfer_ventas(
    pool: ConnectionPool,
    cod_cliente: Any,
    nro_lugar_entrega: Any,
    cvu_cbu: Any = "",
) -> Dict[str, Any]:
    try:
        parsed_cod_cliente = int(cod_cliente)
        parsed_nro_lugar = int(nro_lugar_entrega)
    except (TypeError, ValueError):
        return {
            "error": "invalid_params",
            "details": "cod_cliente and nro_lugar_entrega must be integers.",
        }

    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    account_value = str(cvu_cbu or "").strip()

    location_cte = """
            WITH linked_locations AS (
                SELECT DISTINCT
                    u.cod_cliente,
                    u.nro_lugar_entrega
                FROM dbo.UsuariosTransferencia AS u
                WHERE u.cvu_cbu = ?
                  AND u.cod_cliente IS NOT NULL
                  AND u.nro_lugar_entrega IS NOT NULL

                UNION

                SELECT
                    CAST(? AS numeric(18, 0)) AS cod_cliente,
                    CAST(? AS numeric(18, 0)) AS nro_lugar_entrega
            ),
            expanded_locations AS (
                SELECT
                    cod_cliente,
                    nro_lugar_entrega
                FROM linked_locations

                UNION

                SELECT
                    le_all.cod_cliente,
                    le_all.nro_lugar_entrega
                FROM linked_locations AS linked
                INNER JOIN dbo.LugarEntrega AS le_linked
                    ON le_linked.cod_cliente = linked.cod_cliente
                   AND le_linked.nro_lugar_entrega = linked.nro_lugar_entrega
                INNER JOIN dbo.LugarEntrega AS le_all
                    ON le_all.cod_cliente = linked.cod_cliente
                WHERE UPPER(LTRIM(RTRIM(COALESCE(le_linked.tipo_lugar, '')))) = 'C'
            )
    """

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET LOCK_TIMEOUT 5000;")
        cursor.execute(
            location_cte + """
            , item_totals AS (
                SELECT
                    tipo_comprobante,
                    prefijo,
                    numero,
                    SUM(COALESCE(importe, 0)) AS monto
                FROM dbo.VentasItems
                GROUP BY tipo_comprobante, prefijo, numero
            ),
            applied_totals AS (
                SELECT
                    tipo_comprobante,
                    prefijo,
                    numero,
                    SUM(COALESCE(importe_aplicado, 0)) AS importe_aplicado
                FROM dbo.CobrosAplicados
                GROUP BY tipo_comprobante, prefijo, numero
            )
            SELECT
                LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
                v.prefijo,
                v.numero,
                v.fecha_vencimiento,
                v.Mcampo_control AS mcampo_control,
                v.cod_cliente,
                v.nro_lugar_entrega,
                CONCAT(
                    CONVERT(varchar(20), v.cod_cliente),
                    '-',
                    CONVERT(varchar(20), v.nro_lugar_entrega)
                ) AS cliente,
                COALESCE(it.monto, 0) AS monto,
                CASE
                    WHEN v.Mcampo_control IS NULL THEN COALESCE(atot.importe_aplicado, 0)
                    ELSE 0
                END AS importe_aplicado,
                CASE
                    WHEN v.Mcampo_control IS NULL
                        THEN COALESCE(it.monto, 0) - COALESCE(atot.importe_aplicado, 0)
                    ELSE COALESCE(it.monto, 0)
                END AS deuda
            FROM dbo.Ventas AS v
            LEFT JOIN item_totals AS it
                ON it.tipo_comprobante = v.tipo_comprobante
               AND it.prefijo = v.prefijo
               AND it.numero = v.numero
            LEFT JOIN applied_totals AS atot
                ON atot.tipo_comprobante = v.tipo_comprobante
               AND atot.prefijo = v.prefijo
               AND atot.numero = v.numero
            INNER JOIN expanded_locations AS loc
                ON loc.cod_cliente = v.cod_cliente
               AND loc.nro_lugar_entrega = v.nro_lugar_entrega
            WHERE v.fecha_vencimiento >= DATEADD(month, -12, GETDATE())
            ORDER BY v.fecha_vencimiento DESC, v.prefijo DESC, v.numero DESC;
            """,
            (
                account_value,
                parsed_cod_cliente,
                parsed_nro_lugar,
            ),
        )
        columns = [column[0] for column in cursor.description]
        rows = [
            _serialize_db_row(columns, row)
            for row in cursor.fetchall()
        ]

        cursor.execute(
            location_cte + """
            SELECT
                le.cod_cliente,
                le.nro_lugar_entrega,
                CONCAT(
                    CONVERT(varchar(20), le.cod_cliente),
                    '-',
                    CONVERT(varchar(20), le.nro_lugar_entrega)
                ) AS cliente,
                UPPER(LTRIM(RTRIM(COALESCE(le.tipo_lugar, '')))) AS tipo_lugar,
                LTRIM(RTRIM(CONCAT(
                    COALESCE(NULLIF(LTRIM(RTRIM(ca.nombre)), ''), ''),
                    CASE
                        WHEN le.numeropuerta IS NULL OR le.numeropuerta = 0 THEN ''
                        ELSE CONCAT(' ', CONVERT(varchar(20), le.numeropuerta))
                    END,
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.observ_domicilio, ''))), '') IS NULL THEN ''
                        ELSE CONCAT(' ', LTRIM(RTRIM(le.observ_domicilio)))
                    END,
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(COALESCE(le.[2observ_domicilio], ''))), '') IS NULL THEN ''
                        ELSE CONCAT(' ', LTRIM(RTRIM(le.[2observ_domicilio])))
                    END,
                    CASE
                        WHEN NULLIF(LTRIM(RTRIM(COALESCE(m.nombre, ''))), '') IS NULL THEN ''
                        ELSE CONCAT(' - ', LTRIM(RTRIM(m.nombre)))
                    END
                ))) AS direccion
            FROM expanded_locations AS loc
            INNER JOIN dbo.LugarEntrega AS le
                ON le.cod_cliente = loc.cod_cliente
               AND le.nro_lugar_entrega = loc.nro_lugar_entrega
            LEFT JOIN dbo.Calle AS ca
                ON ca.cod_municipio = le.cod_municipio
               AND ca.cod_calle = le.cod_calle
            LEFT JOIN dbo.Municipio AS m
                ON m.cod_municipio = le.cod_municipio
            ORDER BY le.cod_cliente, le.nro_lugar_entrega;
            """,
            (
                account_value,
                parsed_cod_cliente,
                parsed_nro_lugar,
            ),
        )
        address_columns = [column[0] for column in cursor.description]
        addresses = [
            _serialize_db_row(address_columns, row)
            for row in cursor.fetchall()
        ]

        return {
            "columns": columns,
            "rows": rows,
            "address_columns": address_columns,
            "addresses": addresses,
        }
    except pyodbc.Error as exc:
        pool.discard(conn)
        conn = None
        return {"error": "db_execute_failed", "details": str(exc)}
    finally:
        _close_cursor(cursor)
        pool.release(conn)


def check_cobro_comprobante(
    pool: ConnectionPool,
    tipo_comprobante: Any,
    prefijo: Any,
    numero: Any,
) -> Dict[str, Any]:
    tipo_value = str(tipo_comprobante or "").strip().upper()
    if not tipo_value:
        return {
            "error": "invalid_params",
            "details": "tipo_comprobante is required.",
        }

    try:
        parsed_prefijo = int(prefijo)
        parsed_numero = int(numero)
    except (TypeError, ValueError):
        return {
            "error": "invalid_params",
            "details": "prefijo and numero must be integers.",
        }

    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET LOCK_TIMEOUT 5000;")
        cursor.execute(
            """
            SELECT COUNT_BIG(1)
            FROM dbo.Cobros
            WHERE LTRIM(RTRIM(tipo_comprobante_cobro)) = ?
              AND prefijo_recibo = ?
              AND numero_recibo = ?;
            """,
            (tipo_value, parsed_prefijo, parsed_numero),
        )
        count = int(cursor.fetchone()[0])
        return {
            "exists": count > 0,
            "count": count,
            "tipo_comprobante": tipo_value,
            "prefijo": parsed_prefijo,
            "numero": parsed_numero,
        }
    except pyodbc.Error as exc:
        pool.discard(conn)
        conn = None
        return {"error": "db_execute_failed", "details": str(exc)}
    finally:
        _close_cursor(cursor)
        pool.release(conn)


def _parse_comprobante_parts(
    tipo_comprobante: Any,
    prefijo: Any,
    numero: Any,
) -> Tuple[str, int, int]:
    tipo_value = str(tipo_comprobante or "").strip().upper()
    if not tipo_value:
        raise ValueError("tipo_comprobante is required.")
    try:
        parsed_prefijo = int(prefijo)
        parsed_numero = int(numero)
    except (TypeError, ValueError) as exc:
        raise ValueError("prefijo and numero must be integers.") from exc
    return tipo_value, parsed_prefijo, parsed_numero


def _decimal_from_any(value: Any, field_name: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be numeric.") from exc


def apply_transfer_payment(
    pool: ConnectionPool,
    receipt_comprobante: Any,
    receipt_client: Any,
    transfer_amount: Any,
    selected_ventas: Any,
    transfer_id: Any = None,
) -> Dict[str, Any]:
    if not isinstance(receipt_comprobante, dict):
        return {
            "error": "invalid_params",
            "details": "receipt_comprobante must be an object.",
        }
    if not isinstance(receipt_client, dict):
        return {
            "error": "invalid_params",
            "details": "receipt_client must be an object.",
        }
    if not isinstance(selected_ventas, list) or len(selected_ventas) == 0:
        return {
            "error": "invalid_params",
            "details": "selected_ventas must contain at least one venta.",
        }

    try:
        receipt_tipo, receipt_prefijo, receipt_numero = _parse_comprobante_parts(
            receipt_comprobante.get("tipoComprobante"),
            receipt_comprobante.get("prefijo"),
            receipt_comprobante.get("numero"),
        )
        receipt_cod_cliente = int(receipt_client.get("codCliente"))
        receipt_nro_lugar = int(receipt_client.get("nroLugarEntrega"))
        wire_amount = _decimal_from_any(transfer_amount, "transfer_amount")
        parsed_transfer_id = int(transfer_id) if transfer_id not in (None, "") else None
    except ValueError as exc:
        return {"error": "invalid_params", "details": str(exc)}
    except (TypeError, ValueError) as exc:
        return {
            "error": "invalid_params",
            "details": "receipt client codCliente and nroLugarEntrega must be integers.",
        }

    if wire_amount <= 0:
        return {
            "error": "invalid_params",
            "details": "transfer_amount must be greater than zero.",
        }

    if parsed_transfer_id is not None and parsed_transfer_id <= 0:
        return {
            "error": "invalid_params",
            "details": "transfer_id must be greater than zero.",
        }

    receipt_date = datetime.now().replace(microsecond=0)
    selected_keys: List[Tuple[str, int, int]] = []
    seen_keys = set()
    for venta in selected_ventas:
        if not isinstance(venta, dict):
            return {
                "error": "invalid_params",
                "details": "Each selected venta must be an object.",
            }
        try:
            key = _parse_comprobante_parts(
                venta.get("tipoComprobante"),
                venta.get("prefijo"),
                venta.get("numero"),
            )
        except ValueError as exc:
            return {"error": "invalid_params", "details": str(exc)}
        if key in seen_keys:
            continue
        seen_keys.add(key)
        selected_keys.append(key)

    if not selected_keys:
        return {
            "error": "invalid_params",
            "details": "selected_ventas does not contain valid comprobantes.",
        }

    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;")

        if parsed_transfer_id is not None:
            cursor.execute(
                """
                SELECT TOP (1)
                    estado,
                    fecha
                FROM dbo.Transferencias WITH (UPDLOCK, HOLDLOCK)
                WHERE id_transferencia = ?;
                """,
                (parsed_transfer_id,),
            )
            transfer_row = cursor.fetchone()
            if transfer_row is None:
                conn.rollback()
                return {
                    "error": "transferencia_not_found",
                    "details": "No existe la transferencia seleccionada.",
                }

            transfer_status = str(transfer_row.estado or "").strip().upper()
            if transfer_status == "CARGADA":
                conn.rollback()
                return {
                    "error": "transferencia_already_loaded",
                    "details": "La transferencia seleccionada ya fue cargada.",
                }
            transfer_fecha = getattr(transfer_row, "fecha", None)
            if isinstance(transfer_fecha, datetime):
                receipt_date = transfer_fecha.replace(microsecond=0)
            elif isinstance(transfer_fecha, date):
                receipt_date = datetime.combine(transfer_fecha, datetime.min.time())
            elif transfer_fecha:
                try:
                    receipt_date = datetime.fromisoformat(
                        str(transfer_fecha).replace("Z", "")
                    ).replace(microsecond=0)
                except ValueError:
                    pass

        cursor.execute(
            """
            SELECT TOP (1) 1
            FROM dbo.Cobros WITH (UPDLOCK, HOLDLOCK)
            WHERE LTRIM(RTRIM(tipo_comprobante_cobro)) = ?
              AND prefijo_recibo = ?
              AND numero_recibo = ?;
            """,
            (receipt_tipo, receipt_prefijo, receipt_numero),
        )
        if cursor.fetchone() is not None:
            conn.rollback()
            return {
                "error": "comprobante_exists",
                "details": "El comprobante de cobro ya existe en Cobros.",
            }

        venta_records: List[Dict[str, Any]] = []
        for tipo, prefijo, numero in selected_keys:
            cursor.execute(
                """
                SELECT TOP (1)
                    LTRIM(RTRIM(v.tipo_comprobante)) AS tipo_comprobante,
                    v.prefijo,
                    v.numero,
                    v.fecha_vencimiento,
                    v.Mcampo_control,
                    COALESCE((
                        SELECT SUM(COALESCE(vi.importe, 0))
                        FROM dbo.VentasItems AS vi
                        WHERE vi.tipo_comprobante = v.tipo_comprobante
                          AND vi.prefijo = v.prefijo
                          AND vi.numero = v.numero
                    ), 0) AS monto,
                    COALESCE((
                        SELECT SUM(COALESCE(ca.importe_aplicado, 0))
                        FROM dbo.CobrosAplicados AS ca
                        WHERE ca.tipo_comprobante = v.tipo_comprobante
                          AND ca.prefijo = v.prefijo
                          AND ca.numero = v.numero
                    ), 0) AS importe_aplicado
                FROM dbo.Ventas AS v WITH (UPDLOCK, HOLDLOCK)
                WHERE LTRIM(RTRIM(v.tipo_comprobante)) = ?
                  AND v.prefijo = ?
                  AND v.numero = ?;
                """,
                (tipo, prefijo, numero),
            )
            row = cursor.fetchone()
            if row is None:
                conn.rollback()
                return {
                    "error": "venta_not_found",
                    "details": f"No existe la venta {tipo} {prefijo} {numero}.",
                }

            control = str(row.Mcampo_control or "").strip().upper()
            if control == "P":
                conn.rollback()
                return {
                    "error": "venta_already_paid",
                    "details": f"La venta {tipo} {prefijo} {numero} ya esta pagada.",
                }

            monto = Decimal(str(row.monto or 0))
            importe_aplicado = Decimal(str(row.importe_aplicado or 0))
            deuda = monto - importe_aplicado
            if deuda <= 0:
                conn.rollback()
                return {
                    "error": "venta_without_debt",
                    "details": f"La venta {tipo} {prefijo} {numero} no tiene deuda.",
                }

            venta_records.append(
                {
                    "tipo_comprobante": tipo,
                    "prefijo": prefijo,
                    "numero": numero,
                    "fecha_vencimiento": row.fecha_vencimiento,
                    "deuda": deuda,
                }
            )

        venta_records.sort(
            key=lambda record: (
                str(record["fecha_vencimiento"] or ""),
                record["tipo_comprobante"],
                record["prefijo"],
                record["numero"],
            )
        )

        cursor.execute(
            """
            INSERT INTO dbo.Cobros
            (
                tipo_comprobante_cobro,
                prefijo_recibo,
                numero_recibo,
                fecha_recibo,
                cod_cliente,
                nro_lugar_entrega,
                saca_c
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL);
            """,
            (
                receipt_tipo,
                receipt_prefijo,
                receipt_numero,
                receipt_date,
                receipt_cod_cliente,
                receipt_nro_lugar,
            ),
        )

        remaining = wire_amount
        applied_rows: List[Dict[str, Any]] = []
        paid_updates = 0
        for record in venta_records:
            if remaining <= 0:
                break
            apply_amount = record["deuda"] if record["deuda"] <= remaining else remaining
            if apply_amount <= 0:
                continue

            cursor.execute(
                """
                INSERT INTO dbo.CobrosAplicados
                (
                    tipo_comprobante_cobro,
                    prefijo_recibo,
                    numero_recibo,
                    tipo_comprobante,
                    prefijo,
                    numero,
                    importe_aplicado,
                    numero_ci,
                    saca_ca
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL);
                """,
                (
                    receipt_tipo,
                    receipt_prefijo,
                    receipt_numero,
                    record["tipo_comprobante"],
                    record["prefijo"],
                    record["numero"],
                    apply_amount,
                ),
            )

            fully_paid = apply_amount >= record["deuda"]
            if fully_paid:
                cursor.execute(
                    """
                    UPDATE dbo.Ventas
                    SET Mcampo_control = 'P'
                    WHERE LTRIM(RTRIM(tipo_comprobante)) = ?
                      AND prefijo = ?
                      AND numero = ?;
                    """,
                    (
                        record["tipo_comprobante"],
                        record["prefijo"],
                        record["numero"],
                    ),
                )
                paid_updates += cursor.rowcount if cursor.rowcount is not None else 0

            applied_rows.append(
                {
                    "tipo_comprobante": record["tipo_comprobante"],
                    "prefijo": record["prefijo"],
                    "numero": record["numero"],
                    "importe_aplicado": str(apply_amount),
                    "fully_paid": fully_paid,
                }
            )
            remaining -= apply_amount

        if not applied_rows:
            conn.rollback()
            return {
                "error": "nothing_applied",
                "details": "No se pudo aplicar ningun importe.",
            }

        transferencias_updated = 0
        if parsed_transfer_id is not None:
            cursor.execute(
                """
                UPDATE dbo.Transferencias
                SET estado = 'CARGADA'
                WHERE id_transferencia = ?
                  AND estado = 'NO-CARGADA';
                """,
                (parsed_transfer_id,),
            )
            transferencias_updated = cursor.rowcount if cursor.rowcount is not None else 0

        conn.commit()
        return {
            "status": "saved",
            "cobro": {
                "tipo_comprobante_cobro": receipt_tipo,
                "prefijo_recibo": receipt_prefijo,
                "numero_recibo": receipt_numero,
                "fecha_recibo": receipt_date.isoformat(timespec="seconds"),
                "cod_cliente": receipt_cod_cliente,
                "nro_lugar_entrega": receipt_nro_lugar,
            },
            "cobros_aplicados": applied_rows,
            "inserted_cobros": 1,
            "inserted_cobros_aplicados": len(applied_rows),
            "updated_ventas": paid_updates,
            "updated_transferencias": transferencias_updated,
            "remaining_transfer_amount": str(remaining),
        }
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


def assign_transferencia_account(
    pool: ConnectionPool,
    cvu_cbu: Any,
    cod_cliente: Any,
    nro_lugar_entrega: Any,
) -> Dict[str, Any]:
    account_value = str(cvu_cbu or "").strip()
    if not re.fullmatch(r"\d{22}", account_value):
        return {
            "error": "invalid_params",
            "details": "cvu_cbu must contain 22 digits.",
        }

    try:
        parsed_cod_cliente = int(cod_cliente)
        parsed_nro_lugar = int(nro_lugar_entrega)
    except (TypeError, ValueError):
        return {
            "error": "invalid_params",
            "details": "cod_cliente and nro_lugar_entrega must be integers.",
        }

    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute("SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000;")
        cursor.execute(
            """
            SELECT TOP (1) 1
            FROM dbo.LugarEntrega WITH (HOLDLOCK)
            WHERE cod_cliente = ?
              AND nro_lugar_entrega = ?;
            """,
            (parsed_cod_cliente, parsed_nro_lugar),
        )
        if cursor.fetchone() is None:
            conn.rollback()
            return {
                "error": "not_found",
                "details": "No existe ese cliente/lugar de entrega.",
            }

        cursor.execute(
            """
            SELECT TOP (1)
                id_usuario_transferencia,
                cod_cliente,
                nro_lugar_entrega,
                orden
            FROM dbo.UsuariosTransferencia WITH (UPDLOCK, HOLDLOCK)
            WHERE cvu_cbu = ?;
            """,
            (account_value,),
        )
        existing_owner = cursor.fetchone()

        if existing_owner is not None:
            owner_id = int(existing_owner[0])
            if int(existing_owner[1]) != parsed_cod_cliente or int(existing_owner[2]) != parsed_nro_lugar:
                conn.rollback()
                return {
                    "error": "account_already_assigned",
                    "details": "Ese CBU/CVU ya esta asignado a otro cliente/lugar.",
                }
            owner = {
                "id_usuario_transferencia": owner_id,
                "cod_cliente": parsed_cod_cliente,
                "nro_lugar_entrega": parsed_nro_lugar,
                "orden": existing_owner[3],
            }
            created_owner = False
        else:
            cursor.execute(
                """
                SELECT COALESCE(MAX(orden), 0) + 1
                FROM dbo.UsuariosTransferencia WITH (UPDLOCK, HOLDLOCK)
                WHERE cod_cliente = ?
                  AND nro_lugar_entrega = ?;
                """,
                (parsed_cod_cliente, parsed_nro_lugar),
            )
            next_order = int(cursor.fetchone()[0])
            cursor.execute(
                """
                INSERT INTO dbo.UsuariosTransferencia
                (
                    cod_cliente,
                    nro_lugar_entrega,
                    cvu_cbu,
                    orden
                )
                OUTPUT INSERTED.id_usuario_transferencia
                VALUES (?, ?, ?, ?);
                """,
                (
                    parsed_cod_cliente,
                    parsed_nro_lugar,
                    account_value,
                    next_order,
                ),
            )
            owner_id = int(cursor.fetchone()[0])
            owner = {
                "id_usuario_transferencia": owner_id,
                "cod_cliente": parsed_cod_cliente,
                "nro_lugar_entrega": parsed_nro_lugar,
                "orden": next_order,
            }
            created_owner = True

        cursor.execute(
            """
            UPDATE dbo.Transferencias
            SET id_usuario_transferencia = ?
            WHERE cvu_cbu = ?;
            """,
            (owner_id, account_value),
        )
        updated_count = cursor.rowcount if cursor.rowcount is not None else 0
        conn.commit()
        return {
            "status": "assigned",
            "updated_transferencias": updated_count,
            "created_usuario_transferencia": created_owner,
            "owner": owner,
        }
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


def _analysis_matches_image_path(analysis: Any, image_path: Any) -> bool:
    if not isinstance(analysis, dict):
        return False
    analysis_file = analysis.get("file")
    if not isinstance(analysis_file, dict):
        return False
    analyzed_path = analysis_file.get("path")
    if not analyzed_path:
        return False
    try:
        return os.path.abspath(str(analyzed_path)) == os.path.abspath(str(image_path))
    except (TypeError, ValueError):
        return False


def _first_ocr_text(*values: Any) -> Optional[str]:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def _ocr_account_value(analysis: Dict[str, Any], account: Dict[str, Any]) -> Optional[str]:
    match = analysis.get("match") if isinstance(analysis.get("match"), dict) else {}
    for raw_value in (
        account.get("value"),
        account.get("formatted"),
        match.get("number"),
    ):
        digits = normalize_account_digits(str(raw_value or ""))
        if len(digits) >= 22:
            return digits[:22]
    return None


def _ocr_amount_value(analysis: Dict[str, Any], amount: Dict[str, Any]) -> Optional[Decimal]:
    for raw_value in (
        amount.get("value"),
        analysis.get("amount"),
        amount.get("display"),
        amount.get("raw"),
    ):
        text = _first_ocr_text(raw_value)
        if not text:
            continue
        try:
            parsed_decimal = Decimal(text)
        except InvalidOperation:
            amount_text = re.sub(r"(?i)\bARS\b|[$§]", "", text).strip()
            parsed = parse_amount(amount_text)
            if parsed is None:
                continue
            parsed_decimal = parsed["decimal"]
        if parsed_decimal > 0:
            return parsed_decimal.quantize(Decimal("0.01"))
    return None


def _parse_ocr_datetime_text(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value.replace(microsecond=0)
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())

    raw = _first_ocr_text(value)
    if not raw:
        return None

    normalized = (
        raw.replace("–", "-")
        .replace("—", "-")
        .replace(",", " ")
        .strip()
    )
    normalized = re.sub(r"\s*(?:hs?\.?|horas?)\b\.?", "", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"\s+", " ", normalized).strip()

    iso_candidate = normalized.replace("Z", "")
    try:
        return datetime.fromisoformat(iso_candidate).replace(microsecond=0)
    except ValueError:
        pass

    for date_format in (
        "%d/%m/%Y - %H:%M",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
        "%d-%m-%Y - %H:%M",
        "%d-%m-%Y %H:%M",
        "%d-%m-%Y",
        "%d.%m.%Y - %H:%M",
        "%d.%m.%Y %H:%M",
        "%d.%m.%Y",
    ):
        try:
            return datetime.strptime(normalized, date_format).replace(microsecond=0)
        except ValueError:
            continue

    parsed = parse_mercado_pago_text(normalized)
    parsed_date = parsed.get("fields", {}).get("payment_date", {})
    for parsed_value in (parsed_date.get("datetime"), parsed_date.get("value")):
        if parsed_value and parsed_value != raw:
            reparsed = _parse_ocr_datetime_text(parsed_value)
            if reparsed is not None:
                return reparsed
    return None


def _ocr_payment_datetime(
    analysis: Dict[str, Any],
    payment_date: Dict[str, Any],
) -> Optional[datetime]:
    for raw_value in (
        payment_date.get("datetime"),
        payment_date.get("value"),
        payment_date.get("display"),
        analysis.get("created"),
        payment_date.get("raw"),
    ):
        parsed = _parse_ocr_datetime_text(raw_value)
        if parsed is not None:
            return parsed
    return None


def process_upload_image(
    pool: ConnectionPool,
    image_path: Any,
    allow_duplicate: Any = False,
    analysis_override: Any = None,
) -> Dict[str, Any]:
    if _analysis_matches_image_path(analysis_override, image_path):
        analysis = analysis_override
    else:
        analysis = analyze_upload_image(pool, image_path)
    if analysis.get("error"):
        return analysis

    fields = analysis.get("fields") or {}
    account = fields.get("account") or {}
    amount = fields.get("amount") or {}
    payment_date = fields.get("payment_date") or {}
    payer = fields.get("payer_name") or {}

    account_value = _ocr_account_value(analysis, account)
    amount_value = _ocr_amount_value(analysis, amount)
    transfer_date = _ocr_payment_datetime(analysis, payment_date)

    required_values = {
        "account": account_value,
        "amount": amount_value,
        "payment_date": transfer_date,
    }
    missing = [name for name, value in required_values.items() if not value]
    if missing:
        missing_labels = {
            "account": "CBU/CVU",
            "amount": "monto",
            "payment_date": "fecha",
        }
        missing_display = ", ".join(
            missing_labels.get(name, name) for name in missing
        )
        return {
            "error": "ocr_fields_missing",
            "details": (
                "No se puede guardar el comprobante porque faltan datos OCR "
                f"requeridos: {missing_display}."
            ),
            "missing_fields": missing,
            "analysis": analysis,
        }

    account_value = str(required_values["account"])
    amount_value = required_values["amount"]
    transfer_date = required_values["payment_date"]
    payer_name = payer.get("value")
    associated_name = str(payer_name).strip()[:160] if payer_name else None
    allow_duplicate_value = bool(allow_duplicate)

    try:
        conn = pool.acquire()
    except ConnectionAcquireError as exc:
        return {"error": "connection_failed", "details": exc.details}

    cursor: Optional['pyodbc.Cursor'] = None
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
                t.id_transferencia,
                t.cvu_cbu,
                t.monto,
                t.fecha,
                t.nombre_asociado,
                t.estado,
                t.id_usuario_transferencia,
                u.cod_cliente,
                u.nro_lugar_entrega,
                u.orden
            FROM dbo.Transferencias AS t WITH (UPDLOCK, HOLDLOCK)
            INNER JOIN dbo.UsuariosTransferencia AS u
                ON u.id_usuario_transferencia = t.id_usuario_transferencia
            WHERE t.cvu_cbu = ?
              AND t.monto = ?
              AND t.fecha = ?
            ORDER BY t.id_transferencia DESC;
            """,
            (account_value, amount_value, transfer_date),
        )
        duplicate_columns = [column[0] for column in cursor.description]
        duplicate_rows = [
            _serialize_transfer_row(duplicate_columns, row)
            for row in cursor.fetchall()
        ]

        if duplicate_rows and not allow_duplicate_value:
            conn.rollback()
            return {
                "status": "duplicate",
                "analysis": analysis,
                "duplicate": duplicate_rows[0],
                "duplicates": duplicate_rows,
            }

        cursor.execute(
            """
            SELECT TOP (1)
                id_usuario_transferencia,
                cod_cliente,
                nro_lugar_entrega,
                orden
            FROM dbo.UsuariosTransferencia
            WHERE cvu_cbu = ?
            ORDER BY id_usuario_transferencia;
            """,
            (account_value,),
        )
        owner_row = cursor.fetchone()

        if owner_row is None:
            cursor.execute(
                """
                SELECT TOP (1)
                    id_usuario_transferencia,
                    cod_cliente,
                    nro_lugar_entrega,
                    orden
                FROM dbo.UsuariosTransferencia
                WHERE cod_cliente IS NULL
                  AND nro_lugar_entrega IS NULL
                  AND cvu_cbu IS NULL
                  AND orden = 0
                ORDER BY id_usuario_transferencia;
                """
            )
            owner_row = cursor.fetchone()

        if owner_row is None:
            conn.rollback()
            return {
                "error": "unidentified_user_missing",
                "details": "No existe el usuario de transferencias sin identificar.",
                "analysis": analysis,
            }

        owner = {
            "id_usuario_transferencia": owner_row[0],
            "cod_cliente": owner_row[1],
            "nro_lugar_entrega": owner_row[2],
            "orden": owner_row[3],
        }
        cursor.execute(
            """
            INSERT INTO dbo.Transferencias
            (
                cvu_cbu,
                monto,
                id_usuario_transferencia,
                fecha,
                nombre_asociado
            )
            OUTPUT
                INSERTED.id_transferencia,
                INSERTED.cvu_cbu,
                INSERTED.monto,
                INSERTED.fecha,
                INSERTED.nombre_asociado,
                INSERTED.estado,
                INSERTED.id_usuario_transferencia
            VALUES (?, ?, ?, ?, ?);
            """,
            (
                account_value,
                amount_value,
                owner["id_usuario_transferencia"],
                transfer_date,
                associated_name,
            ),
        )
        inserted_columns = [column[0] for column in cursor.description]
        inserted = _serialize_transfer_row(inserted_columns, cursor.fetchone())
        inserted.update(
            {
                "cod_cliente": owner["cod_cliente"],
                "nro_lugar_entrega": owner["nro_lugar_entrega"],
                "orden": owner["orden"],
            }
        )
        conn.commit()
    except pyodbc.Error as exc:
        try:
            conn.rollback()
        except pyodbc.Error:
            pass
        pool.discard(conn)
        conn = None
        return {
            "error": "db_execute_failed",
            "details": str(exc),
            "analysis": analysis,
        }
    finally:
        _close_cursor(cursor)
        pool.release(conn)

    cleanup = mark_upload_processed(image_path)
    result = {
        "status": "stored",
        "analysis": analysis,
        "transfer": inserted,
        "owner": owner,
        "duplicate_override": bool(duplicate_rows),
    }
    if cleanup.get("error"):
        result["cleanup_warning"] = cleanup
    else:
        result["processed_file"] = cleanup
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


def _handle_process_upload_image(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if not 1 <= len(params) <= 3:
        return {
            "error": "invalid_params",
            "details": "process_upload_image expects image_path, optional allow_duplicate and optional analysis",
        }
    allow_duplicate = params[1] if len(params) >= 2 else False
    analysis_override = params[2] if len(params) == 3 else None
    return process_upload_image(pool, params[0], allow_duplicate, analysis_override)


def _handle_mark_upload_processed(
    _pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 1:
        return {
            "error": "invalid_params",
            "details": "mark_upload_processed expects image_path",
        }
    return mark_upload_processed(params[0])


def _handle_list_transfer_table(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 1:
        return {
            "error": "invalid_params",
            "details": "list_transfer_table expects table_name",
        }
    return list_transfer_table(pool, params[0])


def _handle_delete_transfer_table_row(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 2:
        return {
            "error": "invalid_params",
            "details": "delete_transfer_table_row expects table_name and row_id",
        }
    return delete_transfer_table_row(pool, params[0], params[1])


def _handle_add_usuario_transferencia(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 1:
        return {
            "error": "invalid_params",
            "details": "add_usuario_transferencia expects payload",
        }
    return add_usuario_transferencia(pool, params[0])


def _handle_list_unidentified_transferencias(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 0:
        return {
            "error": "invalid_params",
            "details": "list_unidentified_transferencias does not accept parameters",
        }
    return list_unidentified_transferencias(pool)


def _handle_list_identified_transferencias(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 0:
        return {
            "error": "invalid_params",
            "details": "list_identified_transferencias does not accept parameters",
        }
    return list_identified_transferencias(pool)


def _handle_list_transfer_address_candidates(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 0:
        return {
            "error": "invalid_params",
            "details": "list_transfer_address_candidates does not accept parameters",
        }
    return list_transfer_address_candidates(pool)


def _handle_list_transfer_ventas(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if not 2 <= len(params) <= 3:
        return {
            "error": "invalid_params",
            "details": "list_transfer_ventas expects cod_cliente, nro_lugar_entrega and optional cvu_cbu",
        }
    cvu_cbu = params[2] if len(params) == 3 else ""
    return list_transfer_ventas(pool, params[0], params[1], cvu_cbu)


def _handle_check_cobro_comprobante(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 3:
        return {
            "error": "invalid_params",
            "details": "check_cobro_comprobante expects tipo_comprobante, prefijo and numero",
        }
    return check_cobro_comprobante(pool, params[0], params[1], params[2])


def _handle_apply_transfer_payment(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if not 4 <= len(params) <= 5:
        return {
            "error": "invalid_params",
            "details": "apply_transfer_payment expects receipt_comprobante, receipt_client, transfer_amount, selected_ventas and optional transfer_id",
        }
    transfer_id = params[4] if len(params) == 5 else None
    return apply_transfer_payment(pool, params[0], params[1], params[2], params[3], transfer_id)


def _handle_assign_transferencia_account(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 3:
        return {
            "error": "invalid_params",
            "details": "assign_transferencia_account expects cvu_cbu, cod_cliente and nro_lugar_entrega",
        }
    return assign_transferencia_account(pool, params[0], params[1], params[2])


def _handle_traer_facultad_facturas(
    pool: ConnectionPool,
    params: Sequence[Any],
) -> Dict[str, Any]:
    if len(params) != 2:
        return {
            "error": "invalid_params",
            "details": "traer_facultad_facturas expects desde and hasta",
        }
    return traer_facultad_facturas(pool, params[0], params[1])


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
    "process_upload_image": _handle_process_upload_image,
    "mark_upload_processed": _handle_mark_upload_processed,
    "list_transfer_table": _handle_list_transfer_table,
    "delete_transfer_table_row": _handle_delete_transfer_table_row,
    "add_usuario_transferencia": _handle_add_usuario_transferencia,
    "list_unidentified_transferencias": _handle_list_unidentified_transferencias,
    "list_identified_transferencias": _handle_list_identified_transferencias,
    "list_transfer_address_candidates": _handle_list_transfer_address_candidates,
    "list_transfer_ventas": _handle_list_transfer_ventas,
    "check_cobro_comprobante": _handle_check_cobro_comprobante,
    "apply_transfer_payment": _handle_apply_transfer_payment,
    "assign_transferencia_account": _handle_assign_transferencia_account,
    "traer_facultad_facturas": _handle_traer_facultad_facturas,
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
