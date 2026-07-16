import unittest
from datetime import date

from comprobante_ocr import merge_ocr_attempts, parse_mercado_pago_text


class MercadoPagoParserTests(unittest.TestCase):
    def test_extracts_current_receipt_fields(self):
        result = parse_mercado_pago_text(
            """
            Comprobante de transferencia
            Juan Perez
            CVU: 0000003100012345678901
            Importe $ 12.345,67
            Creada el 7 de mayo de 2026 - 14:35
            """,
            today=date(2026, 6, 2),
        )

        fields = result["fields"]
        self.assertEqual(fields["payer_name"]["value"], "Juan Perez")
        self.assertEqual(fields["account"]["type"], "CVU")
        self.assertEqual(fields["account"]["value"], "0000003100012345678901")
        self.assertEqual(fields["account"]["validation"], "valid")
        self.assertEqual(fields["amount"]["value"], "12345.67")
        self.assertEqual(fields["amount"]["display"], "$ 12.345,67")
        self.assertEqual(fields["payment_date"]["value"], "2026-05-07")
        self.assertEqual(fields["payment_date"]["datetime"], "2026-05-07T14:35")
        self.assertEqual(fields["payment_date"]["display"], "07/05/2026 - 14:35")
        self.assertEqual(result["missing_fields"], [])

    def test_supports_patnav_displayed_date_layout(self):
        result = parse_mercado_pago_text(
            """
            $ 10.000
            Maria Gomez
            Transferencia recibida
            3 / jun - 09:10 hs
            CBU 2850590940090418135201
            """,
            today=date(2026, 6, 2),
        )

        fields = result["fields"]
        self.assertEqual(fields["payer_name"]["value"], "Maria Gomez")
        self.assertEqual(fields["payment_date"]["value"], "2026-06-03")
        self.assertTrue(fields["payment_date"]["year_inferred"])
        self.assertIn(
            "DATE_YEAR_INFERRED",
            {warning["code"] for warning in result["warnings"]},
        )

    def test_uses_previous_year_across_year_boundary(self):
        result = parse_mercado_pago_text(
            "Creada el 28 de diciembre - 09:10",
            today=date(2026, 1, 3),
        )

        self.assertEqual(result["fields"]["payment_date"]["value"], "2025-12-28")

    def test_accepts_common_ocr_misreads(self):
        result = parse_mercado_pago_text(
            "CVU: OOOOOO31OOO123456789O1\nImporte § 1.250,50",
            today=date(2026, 6, 2),
        )

        self.assertEqual(result["fields"]["account"]["value"], "0000003100012345678901")
        self.assertEqual(result["fields"]["amount"]["value"], "1250.50")

    def test_reports_missing_fields_for_unclear_text(self):
        result = parse_mercado_pago_text(
            "Comprobante borroso sin datos utiles",
            today=date(2026, 6, 2),
        )

        self.assertEqual(
            set(result["missing_fields"]),
            {"payer_name", "account", "amount", "payment_date"},
        )

    def test_merges_strongest_fields_from_multiple_ocr_passes(self):
        result = merge_ocr_attempts(
            [
                {
                    "name": "full",
                    "text": "Ana Lopez\nCVU 0000003100012345678901\nImporte $ 2.500,00",
                    "lines": [],
                },
                {
                    "name": "date_crop",
                    "text": "Creada el 4 de julio de 2026 - 11:20",
                    "lines": [],
                },
            ],
            today=date(2026, 7, 5),
        )

        self.assertEqual(result["missing_fields"], [])
        self.assertEqual(result["fields"]["account"]["source_attempt"], "full")
        self.assertEqual(result["fields"]["payment_date"]["source_attempt"], "date_crop")


if __name__ == "__main__":
    unittest.main()
