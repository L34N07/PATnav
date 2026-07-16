"""Mercado Pago receipt parsing shared by PATNAV's local OCR bridge.

The parsing rules come from PLTNAV's scanner, which targets the current
Mercado Pago receipt layout.  This module deliberately has no Pillow or
Tesseract dependency so its extraction rules can be unit-tested quickly.
"""

from __future__ import annotations

import re
import unicodedata
from collections import OrderedDict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from statistics import mean
from typing import Any, Dict, Iterable, List, Optional, Sequence


ACCOUNT_NUMBER_LENGTH = 22

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

MONTH_PATTERN = "|".join(sorted(MONTH_MAP, key=len, reverse=True))
MONEY_VALUE_PATTERN = r"(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[,.]\d{1,2})?"
CURRENCY_MARK_PATTERN = r"(?:\$|§|ARS\s*)"
CURRENCY_AMOUNT_PATTERN = re.compile(
    rf"{CURRENCY_MARK_PATTERN}\s*({MONEY_VALUE_PATTERN})",
    re.IGNORECASE,
)
LABELED_AMOUNT_PATTERN = re.compile(
    rf"\b(?:monto|importe|total|transferencia|transferiste|recibiste|pago)\b"
    rf"[^0-9$§]{{0,35}}{CURRENCY_MARK_PATTERN}?\s*({MONEY_VALUE_PATTERN})",
    re.IGNORECASE,
)
ACCOUNT_INLINE_PATTERN = re.compile(
    r"\b(C\s*[BV]\s*U)\b\s*[:=\-]?\s*([0-9OIl|\s.\-]{10,48})",
    re.IGNORECASE,
)
ACCOUNT_LABEL_PATTERN = re.compile(r"\b(C\s*[BV]\s*U)\b", re.IGNORECASE)
DIGIT_RUN_PATTERN = re.compile(r"(?:[0-9OIl|][\s.\-]?){18,30}")
SPANISH_DATE_PATTERN = re.compile(
    rf"(\d{{1,2}})\s+de\s+({MONTH_PATTERN})(?:\s+de\s+(\d{{2,4}}))?"
    r"(?:\s*[-–,]?\s*(\d{1,2}:\d{2}))?",
    re.IGNORECASE,
)
DISPLAYED_DATE_PATTERN = re.compile(
    rf"\b(\d{{1,2}})\s*/\s*({MONTH_PATTERN}|[a-záéíóúñ]{{3,10}})\.?"
    r"(?:\s*/\s*(\d{2,4}))?\s*[-–,]?\s*(\d{1,2}:\d{2})",
    re.IGNORECASE,
)
NUMERIC_DATE_PATTERN = re.compile(
    r"\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b"
    r"(?:\s*[-–,]?\s*(\d{1,2}:\d{2}))?",
    re.IGNORECASE,
)
NAME_LABEL_PATTERN = re.compile(
    r"(?:^\s*de\b|\b(?:desde|emisor|enviado por|ordenante|pagador|titular|nombre))"
    r"\b\s*:?\s*(.+)",
    re.IGNORECASE,
)
NAME_NEXT_LINE_PATTERN = re.compile(
    r"^\s*(?:de|desde|emisor|enviado por|ordenante|pagador|titular|nombre)\s*:?\s*$",
    re.IGNORECASE,
)

NOISE_NAME_WORDS = {
    "mercado pago",
    "comprobante",
    "transferencia",
    "transferiste",
    "recibiste",
    "operacion",
    "fecha",
    "monto",
    "importe",
    "total",
    "cbu",
    "cvu",
    "alias",
    "banco",
    "creada",
    "creado",
    "pagaste",
    "pago",
    "identificacion",
}


def parse_mercado_pago_text(
    text: str,
    *,
    ocr_lines: Optional[Sequence[Dict[str, Any]]] = None,
    today: Optional[date] = None,
) -> Dict[str, Any]:
    today = today or date.today()
    lines = normalize_ocr_lines(text, ocr_lines)
    account = extract_account(lines)
    fields = {
        "payer_name": extract_payer_name(lines, account),
        "account": account["field"],
        "amount": extract_amount(lines),
        "payment_date": extract_payment_date(lines, today=today),
    }
    return build_parsed_result(fields, account.get("warning"))


def merge_ocr_attempts(
    attempts: Sequence[Dict[str, Any]],
    *,
    today: Optional[date] = None,
) -> Dict[str, Any]:
    """Select the strongest field from all PATNAV OCR preprocessing passes."""
    parsed_attempts: List[Dict[str, Any]] = []
    for attempt in attempts:
        text = str(attempt.get("text") or "")
        parsed = parse_mercado_pago_text(
            text,
            ocr_lines=attempt.get("lines") or None,
            today=today,
        )
        parsed_attempts.append({**attempt, "parsed": parsed})

    if not parsed_attempts:
        return parse_mercado_pago_text("", today=today)

    fields: Dict[str, Dict[str, Any]] = {}
    for field_name in ("payer_name", "account", "amount", "payment_date"):
        candidates = [
            (attempt["parsed"]["fields"][field_name], attempt)
            for attempt in parsed_attempts
        ]
        selected, source = max(
            candidates,
            key=lambda pair: _field_score(field_name, pair[0]),
        )
        selected = dict(selected)
        if selected.get("validation") != "missing":
            selected["source_attempt"] = source.get("name")
        fields[field_name] = selected

    merged = build_parsed_result(fields)
    best_attempt = max(parsed_attempts, key=_attempt_score)
    merged["text"] = best_attempt.get("text") or ""
    merged["ocr_attempt"] = best_attempt.get("name")
    merged["average_confidence"] = average_line_confidence(
        best_attempt.get("lines") or []
    )
    merged["attempts"] = [
        {
            "name": attempt.get("name"),
            "average_confidence": average_line_confidence(attempt.get("lines") or []),
            "text_length": len(str(attempt.get("text") or "")),
            "missing_fields": attempt["parsed"]["missing_fields"],
        }
        for attempt in parsed_attempts
    ]
    return merged


def build_parsed_result(
    fields: Dict[str, Dict[str, Any]],
    account_warning: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    warnings: List[Dict[str, str]] = []
    payment_date = fields["payment_date"]
    if payment_date.get("year_inferred"):
        warnings.append(
            {
                "code": "DATE_YEAR_INFERRED",
                "message": "El año no apareció en el comprobante y fue inferido.",
            }
        )

    account = fields["account"]
    if account_warning:
        warnings.append(account_warning)
    elif account.get("validation") == "invalid_length":
        warnings.append(
            {
                "code": "ACCOUNT_LENGTH_UNCLEAR",
                "message": "El CBU/CVU detectado no tiene 22 dígitos.",
            }
        )

    missing_fields = [
        field_name
        for field_name, value in fields.items()
        if value.get("validation") == "missing"
    ]
    return {
        "fields": fields,
        "missing_fields": missing_fields,
        "warnings": warnings,
    }


def ocr_data_to_lines(ocr_data: Dict[str, Sequence[Any]]) -> List[Dict[str, Any]]:
    grouped: "OrderedDict[Any, Dict[str, List[Any]]]" = OrderedDict()
    texts = ocr_data.get("text", [])
    total = len(texts)
    for index in range(total):
        text = str(texts[index] or "").strip()
        if not text:
            continue
        confidences = ocr_data.get("conf", [])
        confidence = parse_confidence(confidences[index] if index < len(confidences) else None)
        if confidence is None:
            continue
        key = tuple(
            _sequence_value(ocr_data.get(key_name, []), index, default)
            for key_name, default in (
                ("page_num", 1),
                ("block_num", 0),
                ("par_num", 0),
                ("line_num", 0),
            )
        )
        group = grouped.setdefault(key, {"words": [], "confidences": []})
        group["words"].append(text)
        group["confidences"].append(confidence)

    return [
        {
            "index": index,
            "text": " ".join(group["words"]),
            "confidence": round(mean(group["confidences"]), 3),
        }
        for index, group in enumerate(grouped.values())
    ]


def normalize_ocr_lines(
    text: str,
    ocr_lines: Optional[Sequence[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    if ocr_lines is not None:
        return [
            {
                "index": index,
                "text": str(line.get("text") or "").strip(),
                "confidence": line.get("confidence"),
            }
            for index, line in enumerate(ocr_lines)
            if str(line.get("text") or "").strip()
        ]
    return [
        {"index": index, "text": line.strip(), "confidence": None}
        for index, line in enumerate(text.splitlines())
        if line.strip()
    ]


def extract_account(lines: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    for index, line in enumerate(lines):
        text = str(line["text"])
        match = ACCOUNT_INLINE_PATTERN.search(text)
        if match:
            digits = normalize_account_digits(match.group(2))
            if len(digits) < 10 and index + 1 < len(lines):
                digits = normalize_account_digits(
                    f"{match.group(2)} {lines[index + 1]['text']}"
                )
            if len(digits) >= 10:
                return build_account_field(normalize_account_type(match.group(1)), digits, line)

        label_match = ACCOUNT_LABEL_PATTERN.search(text)
        if label_match and index + 1 < len(lines):
            digits = normalize_account_digits(str(lines[index + 1]["text"]))
            if len(digits) >= 10:
                return build_account_field(
                    normalize_account_type(label_match.group(1)),
                    digits,
                    {
                        "index": index,
                        "confidence": combine_confidences(
                            line.get("confidence"), lines[index + 1].get("confidence")
                        ),
                    },
                )

        digit_match = DIGIT_RUN_PATTERN.search(text)
        if digit_match:
            digits = normalize_account_digits(digit_match.group(0))
            if len(digits) == ACCOUNT_NUMBER_LENGTH:
                result = build_account_field(None, digits, line)
                result["warning"] = {
                    "code": "ACCOUNT_TYPE_NOT_FOUND",
                    "message": "Se detectó una cuenta sin etiqueta CBU/CVU.",
                }
                return result

    return {
        "line_index": None,
        "field": {
            "type": None,
            "value": None,
            "formatted": None,
            "confidence": None,
            "validation": "missing",
        },
    }


def build_account_field(
    account_type: Optional[str],
    digits: str,
    line: Dict[str, Any],
) -> Dict[str, Any]:
    original_length = len(digits)
    if original_length > ACCOUNT_NUMBER_LENGTH:
        digits = digits[:ACCOUNT_NUMBER_LENGTH]
    validation = "valid" if len(digits) == ACCOUNT_NUMBER_LENGTH else "invalid_length"
    result = {
        "line_index": line.get("index"),
        "field": {
            "type": account_type,
            "value": digits,
            "formatted": group_account_number(digits),
            "confidence": line.get("confidence"),
            "validation": validation,
        },
    }
    if original_length > ACCOUNT_NUMBER_LENGTH:
        result["warning"] = {
            "code": "ACCOUNT_NUMBER_TRUNCATED",
            "message": "Se detectaron más de 22 dígitos y se tomó el primer bloque.",
        }
    return result


def extract_payer_name(
    lines: Sequence[Dict[str, Any]],
    account: Dict[str, Any],
) -> Dict[str, Any]:
    for index, line in enumerate(lines):
        if re.search(
            r"\btransferencia\s+(?:recibida|realizada|enviada)\b",
            normalize_text_for_matching(str(line["text"])),
        ) and index > 0:
            name = clean_name(str(lines[index - 1]["text"]))
            if name:
                return _found_field(name, lines[index - 1], "before_transfer_status")

    for index, line in enumerate(lines):
        text = str(line["text"])
        match = NAME_LABEL_PATTERN.search(text)
        if match:
            name = clean_name(match.group(1))
            if name:
                return _found_field(name, line, "labeled_line")
        if NAME_NEXT_LINE_PATTERN.match(text) and index + 1 < len(lines):
            name = clean_name(str(lines[index + 1]["text"]))
            if name:
                return _found_field(name, lines[index + 1], "line_after_label")

    account_line_index = account.get("line_index")
    if isinstance(account_line_index, int) and account_line_index > 0:
        for candidate_index in range(account_line_index - 1, max(-1, account_line_index - 4), -1):
            candidate = lines[candidate_index]
            name = clean_name(str(candidate["text"]))
            if name:
                return _found_field(name, candidate, "near_account")
    return {"value": None, "confidence": None, "validation": "missing"}


def extract_amount(lines: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    candidates: List[Dict[str, Any]] = []
    for line in lines:
        text = str(line["text"])
        for pattern, base_score in (
            (LABELED_AMOUNT_PATTERN, 3),
            (CURRENCY_AMOUNT_PATTERN, 2),
        ):
            for match in pattern.finditer(text):
                parsed = parse_amount(match.group(1))
                if parsed is None:
                    continue
                score = base_score
                if re.search(r"\b(?:monto|importe|total)\b", text, re.IGNORECASE):
                    score += 2
                if "$" in text or "§" in text or "ARS" in text.upper():
                    score += 1
                candidates.append(
                    {
                        "value": str(parsed["decimal"]),
                        "raw": match.group(0).strip(),
                        "display": parsed["display"],
                        "currency": "ARS",
                        "confidence": line.get("confidence"),
                        "validation": "found",
                        "score": score,
                    }
                )
    if not candidates:
        return {
            "value": None,
            "currency": "ARS",
            "confidence": None,
            "validation": "missing",
        }
    selected = dict(max(candidates, key=lambda candidate: candidate["score"]))
    selected.pop("score", None)
    return selected


def extract_payment_date(
    lines: Sequence[Dict[str, Any]],
    *,
    today: date,
) -> Dict[str, Any]:
    candidates: List[Dict[str, Any]] = []
    for line in lines:
        text = str(line["text"])
        normalized_text = normalize_text_for_matching(text)
        for match in SPANISH_DATE_PATTERN.finditer(normalized_text):
            candidate = build_date_candidate(
                day=int(match.group(1)),
                month=MONTH_MAP.get(match.group(2).lower()),
                year_value=match.group(3),
                time_value=match.group(4),
                raw=match.group(0),
                line=line,
                today=today,
                score=3,
            )
            if candidate:
                candidates.append(candidate)
        for match in DISPLAYED_DATE_PATTERN.finditer(normalized_text):
            candidate = build_date_candidate(
                day=int(match.group(1)),
                month=MONTH_MAP.get(match.group(2).lower()),
                year_value=match.group(3),
                time_value=match.group(4),
                raw=match.group(0),
                line=line,
                today=today,
                score=3,
            )
            if candidate:
                candidates.append(candidate)
        for match in NUMERIC_DATE_PATTERN.finditer(text):
            candidate = build_date_candidate(
                day=int(match.group(1)),
                month=int(match.group(2)),
                year_value=match.group(3),
                time_value=match.group(4),
                raw=match.group(0),
                line=line,
                today=today,
                score=2,
            )
            if candidate:
                candidates.append(candidate)
    if not candidates:
        return {
            "value": None,
            "datetime": None,
            "display": None,
            "confidence": None,
            "validation": "missing",
        }
    selected = dict(max(candidates, key=lambda candidate: candidate["score"]))
    selected.pop("score", None)
    return selected


def build_date_candidate(
    *,
    day: int,
    month: Optional[int],
    year_value: Optional[str],
    time_value: Optional[str],
    raw: str,
    line: Dict[str, Any],
    today: date,
    score: int,
) -> Optional[Dict[str, Any]]:
    if month is None:
        return None
    year, year_inferred = parse_year(year_value, today=today, day=day, month=month)
    try:
        parsed_date = date(year, month, day)
    except ValueError:
        return None
    parsed_datetime: Optional[datetime] = None
    if time_value:
        try:
            hour, minute = [int(part) for part in time_value.split(":", 1)]
            parsed_datetime = datetime(year, month, day, hour, minute)
        except ValueError:
            parsed_datetime = None
    if re.search(
        r"\b(?:creada|creado|fecha|operacion|transferencia|pago)\b",
        normalize_text_for_matching(str(line["text"])),
    ):
        score += 2
    display = parsed_date.strftime("%d/%m/%Y")
    if time_value:
        display = f"{display} - {time_value}"
    return {
        "value": parsed_date.isoformat(),
        "datetime": parsed_datetime.isoformat(timespec="minutes") if parsed_datetime else None,
        "display": display,
        "time": time_value,
        "raw": raw.strip(),
        "confidence": line.get("confidence"),
        "validation": "found",
        "year_inferred": year_inferred,
        "score": score,
    }


def parse_amount(value: str) -> Optional[Dict[str, Any]]:
    compact = re.sub(r"\s+", "", str(value or "").strip())
    if not compact:
        return None
    if "." in compact and "," in compact:
        decimal_separator = "." if compact.rfind(".") > compact.rfind(",") else ","
    elif "," in compact:
        decimal_separator = "," if len(compact.rsplit(",", 1)[1]) <= 2 else None
    elif "." in compact:
        decimal_separator = "." if len(compact.rsplit(".", 1)[1]) == 2 else None
    else:
        decimal_separator = None
    if decimal_separator:
        thousands_separator = "," if decimal_separator == "." else "."
        normalized = compact.replace(thousands_separator, "").replace(decimal_separator, ".")
    else:
        normalized = compact.replace(".", "").replace(",", "")
    try:
        amount = Decimal(normalized)
    except InvalidOperation:
        return None
    if amount <= 0:
        return None
    quantized = amount.quantize(Decimal("0.01"))
    return {"decimal": quantized, "display": format_amount_display(quantized)}


def format_amount_display(value: Decimal) -> str:
    whole, decimals = f"{value.quantize(Decimal('0.01')):.2f}".split(".")
    groups = []
    while whole:
        groups.append(whole[-3:])
        whole = whole[:-3]
    return f"$ {'.'.join(reversed(groups))},{decimals}"


def parse_year(
    value: Optional[str],
    *,
    today: date,
    day: int,
    month: int,
) -> tuple[int, bool]:
    if value is not None:
        year = int(value)
        return (2000 + year if year < 100 else year), False
    year = today.year
    try:
        # Keep PLTNAV's current-year behavior for small clock/timezone differences,
        # while retaining PATNAV's year-boundary handling for older receipts.
        if date(year, month, day) > today + timedelta(days=31):
            year -= 1
    except ValueError:
        pass
    return year, True


def parse_confidence(value: Any) -> Optional[float]:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    if confidence < 0:
        return None
    return round(confidence / 100, 3)


def average_line_confidence(lines: Iterable[Dict[str, Any]]) -> Optional[float]:
    values = [
        float(line["confidence"])
        for line in lines
        if isinstance(line.get("confidence"), (int, float))
    ]
    return round(mean(values), 3) if values else None


def combine_confidences(*values: Any) -> Optional[float]:
    valid = [float(value) for value in values if isinstance(value, (int, float))]
    return round(mean(valid), 3) if valid else None


def normalize_account_type(value: str) -> Optional[str]:
    normalized = re.sub(r"\s+", "", value or "").upper()
    if normalized.startswith("CV"):
        return "CVU"
    if normalized.startswith("CB"):
        return "CBU"
    return None


def normalize_account_digits(value: str) -> str:
    translation = str.maketrans(
        {"O": "0", "o": "0", "I": "1", "l": "1", "|": "1"}
    )
    return re.sub(r"\D", "", str(value or "").translate(translation))


def group_account_number(value: str) -> Optional[str]:
    if not value:
        return None
    return " ".join(value[index : index + 4] for index in range(0, len(value), 4))


def clean_name(value: str) -> Optional[str]:
    cleaned = re.sub(r"^[^\w]+", "", str(value or "").strip())
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" .:-")
    if len(cleaned) < 3 or "$" in cleaned or len(re.findall(r"\d", cleaned)) > 1:
        return None
    comparable = strip_accents(cleaned).lower()
    if any(word in comparable for word in NOISE_NAME_WORDS):
        return None
    if not re.search(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]", cleaned):
        return None
    tokens = cleaned.split()
    if len(tokens) >= 2 and len(tokens[0]) == 1:
        cleaned = " ".join(tokens[1:])
    return cleaned


def normalize_text_for_matching(text: str) -> str:
    return strip_accents(str(text or "")).lower()


def strip_accents(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFD", value)
        if unicodedata.category(character) != "Mn"
    )


def _found_field(value: str, line: Dict[str, Any], source: str) -> Dict[str, Any]:
    return {
        "value": value,
        "confidence": line.get("confidence"),
        "validation": "found",
        "source": source,
    }


def _field_score(field_name: str, field: Dict[str, Any]) -> tuple[float, float]:
    validation = field.get("validation")
    if validation == "missing":
        base = 0.0
    elif field_name == "account" and validation == "valid":
        base = 10.0
    elif field_name == "account":
        base = 2.0
    else:
        base = 6.0
    if field_name == "payment_date" and not field.get("year_inferred"):
        base += 1.0
    confidence = field.get("confidence")
    return base, float(confidence) if isinstance(confidence, (int, float)) else 0.0


def _attempt_score(attempt: Dict[str, Any]) -> tuple[int, float, int]:
    parsed = attempt["parsed"]
    found = 4 - len(parsed["missing_fields"])
    confidence = average_line_confidence(attempt.get("lines") or []) or 0.0
    return found, confidence, len(str(attempt.get("text") or ""))


def _sequence_value(values: Sequence[Any], index: int, default: Any) -> Any:
    return values[index] if index < len(values) else default
