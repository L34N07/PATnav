/* ============================================================
   CARGA DE MOVFISICOS + MOVFISICOSITEMS
   Comprobante CI

   Permite cargar múltiples líneas para distintos
   períodos de abono.

   REGLAS:
   - tipo_comprobante = 'CI'
   - prefijo_remito = 0
   - saca_M = NULL
   - Item 1 queda positivo
   - Item 5 queda negativo automáticamente
   - Cantidad = 0 no genera línea
   - nro_orden se genera automáticamente
   - Verifica previamente que el comprobante no exista
   ============================================================ */


/* ============================================================
   DATOS DEL MOVIMIENTO
   ============================================================ */

DECLARE @numero_remito INT = 465803;          -- CAMBIAR
DECLARE @fecha_remito DATE = '2026-08-25';    -- CAMBIAR
DECLARE @cod_cliente INT = 664;               -- CAMBIAR
DECLARE @nro_lugar_entrega INT = 1;           -- CAMBIAR


/* ============================================================
   ITEMS / ABONOS A CARGAR

   Agregar una fila por cada item y período de abono.
   ============================================================ */

DECLARE @Items TABLE
(
    id INT IDENTITY(1,1),
    cod_item INT,
    cantidad DECIMAL(18,2),
    fecha_periodo_abono DATE
);


/* ============================================================
   DATOS DE LOS ITEMS

   FORMATO:
   (cod_item, cantidad, fecha_periodo_abono)

   Podés agregar o quitar todas las filas que necesites.
   ============================================================ */

INSERT INTO @Items
(
    cod_item,
    cantidad,
    fecha_periodo_abono
)
VALUES
    (1, 5, '2026-07-03'),
    (5, 5, '2026-07-03'),

    (1, 2, '2026-08-03'),
    (5, 2, '2026-08-03');


/* ============================================================
   1. COMPROBAR QUE NO EXISTA EL COMPROBANTE
   ============================================================ */

IF EXISTS
(
    SELECT 1
    FROM MovFisicos
    WHERE tipo_comprobante = 'CI'
      AND prefijo_remito = 0
      AND numero_remito = @numero_remito
)
BEGIN

    PRINT 'ERROR: Ya existe un movimiento con este comprobante CI 0.';

    SELECT
        tipo_comprobante,
        prefijo_remito,
        numero_remito,
        fecha_remito,
        cod_cliente,
        nro_lugar_entrega,
        saca_M
    FROM MovFisicos
    WHERE tipo_comprobante = 'CI'
      AND prefijo_remito = 0
      AND numero_remito = @numero_remito;

    RETURN;

END;


/* ============================================================
   2. INSERTAR EN MOVFISICOS
   ============================================================ */

INSERT INTO MovFisicos
(
    tipo_comprobante,
    prefijo_remito,
    numero_remito,
    fecha_remito,
    cod_cliente,
    nro_lugar_entrega,
    saca_M
)
VALUES
(
    'CI',
    0,
    @numero_remito,
    @fecha_remito,
    @cod_cliente,
    @nro_lugar_entrega,
    NULL
);


/* ============================================================
   3. INSERTAR EN MOVFISICOSITEMS
   ============================================================ */

INSERT INTO MovFisicosItems
(
    tipo_comprobante,
    prefijo_remito,
    numero_remito,
    nro_orden,
    cod_item,
    cantidad,
    fecha_periodo_abono,
    saca_mi,
    INFOEXTRA,
    STOCK,
    ultimo_stock
)
SELECT
    'CI',
    0,
    @numero_remito,

    ROW_NUMBER() OVER (ORDER BY id),

    cod_item,

    CASE
        WHEN cod_item = 5
            THEN -ABS(cantidad)
        ELSE ABS(cantidad)
    END,

    fecha_periodo_abono,

    NULL,
    NULL,
    NULL,
    NULL
FROM @Items
WHERE cantidad <> 0;


/* ============================================================
   4. MOSTRAR MOVFISICOS INSERTADO
   ============================================================ */

SELECT
    tipo_comprobante,
    prefijo_remito,
    numero_remito,
    fecha_remito,
    cod_cliente,
    nro_lugar_entrega,
    saca_M
FROM MovFisicos
WHERE tipo_comprobante = 'CI'
  AND prefijo_remito = 0
  AND numero_remito = @numero_remito;


/* ============================================================
   5. MOSTRAR MOVFISICOSITEMS INSERTADOS
   ============================================================ */

SELECT
    tipo_comprobante,
    prefijo_remito,
    numero_remito,
    nro_orden,
    cod_item,
    cantidad,
    fecha_periodo_abono,
    saca_mi,
    INFOEXTRA,
    STOCK,
    ultimo_stock
FROM MovFisicosItems
WHERE tipo_comprobante = 'CI'
  AND prefijo_remito = 0
  AND numero_remito = @numero_remito
ORDER BY nro_orden;