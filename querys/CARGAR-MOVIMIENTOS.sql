/* ============================================================
   CARGA DE MOVFISICOS + MOVFISICOSITEMS
   Permite elegir tipo de comprobante y prefijo
   Verifica previamente que el comprobante no exista
   ============================================================ */


/* ============================================================
   DATOS A INGRESAR
   ============================================================ */

DECLARE @tipo_comprobante VARCHAR(2) = 'CI'; -- CAMBIAR
DECLARE @prefijo_remito INT = 0;             -- CAMBIAR
DECLARE @numero_remito INT = 465805;         -- CAMBIAR

DECLARE @fecha_remito DATE = '2026-08-25';   -- CAMBIAR
DECLARE @cod_cliente INT = 2408;             -- CAMBIAR
DECLARE @nro_lugar_entrega INT = 1;          -- CAMBIAR

/* ITEM 1 */
DECLARE @cantidad_item_1 DECIMAL(18,2) = 4;        -- CAMBIAR
DECLARE @fecha_abono_item_1 DATE = '2026-07-03';   -- CAMBIAR

/* ITEM 5 */
DECLARE @cantidad_item_5 DECIMAL(18,2) = 4;        -- CAMBIAR
DECLARE @fecha_abono_item_5 DATE = '2026-07-03';   -- CAMBIAR


/* ============================================================
   1. COMPROBAR QUE NO EXISTA EL COMPROBANTE
   ============================================================ */

IF EXISTS
(
    SELECT 1
    FROM MovFisicos
    WHERE tipo_comprobante = @tipo_comprobante
      AND prefijo_remito = @prefijo_remito
      AND numero_remito = @numero_remito
)
BEGIN

    PRINT 'ERROR: Ya existe un movimiento con este comprobante.';

    SELECT
        tipo_comprobante,
        prefijo_remito,
        numero_remito,
        fecha_remito,
        cod_cliente,
        nro_lugar_entrega,
        saca_M
    FROM MovFisicos
    WHERE tipo_comprobante = @tipo_comprobante
      AND prefijo_remito = @prefijo_remito
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
    @tipo_comprobante,
    @prefijo_remito,
    @numero_remito,
    @fecha_remito,
    @cod_cliente,
    @nro_lugar_entrega,
    NULL
);


/* ============================================================
   3. INSERTAR EN MOVFISICOSITEMS
   ============================================================ */

DECLARE @nro_orden INT = 1;


/* ---------- ITEM 1 ---------- */

IF @cantidad_item_1 <> 0
BEGIN

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
    VALUES
    (
        @tipo_comprobante,
        @prefijo_remito,
        @numero_remito,
        @nro_orden,
        1,
        @cantidad_item_1,
        @fecha_abono_item_1,
        NULL,
        NULL,
        NULL,
        NULL
    );

    SET @nro_orden = @nro_orden + 1;

END;


/* ---------- ITEM 5 ---------- */

IF @cantidad_item_5 <> 0
BEGIN

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
    VALUES
    (
        @tipo_comprobante,
        @prefijo_remito,
        @numero_remito,
        @nro_orden,
        5,
        -ABS(@cantidad_item_5),
        @fecha_abono_item_5,
        NULL,
        NULL,
        NULL,
        NULL
    );

END;


/* ============================================================
   4. MOSTRAR LO INSERTADO
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
WHERE tipo_comprobante = @tipo_comprobante
  AND prefijo_remito = @prefijo_remito
  AND numero_remito = @numero_remito;


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
WHERE tipo_comprobante = @tipo_comprobante
  AND prefijo_remito = @prefijo_remito
  AND numero_remito = @numero_remito
ORDER BY nro_orden;


