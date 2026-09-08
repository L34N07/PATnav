/* ============================================================
   CARGA DE VENTA + VENTASITEMS
   + MOVFISICOS + MOVFISICOSITEMS

   Comprobante CI 0 NUMX

   MOVIMIENTO FISICO:
   ITEM 1 = LLENOS
   ITEM 5 = VACIOS
   ============================================================ */

SET XACT_ABORT ON;


/* ============================================================
   DATOS A INGRESAR
   ============================================================ */

DECLARE @numero INT = 465676;                -- CAMBIAR
DECLARE @fecha DATE = '2026-08-21';          -- CAMBIAR
DECLARE @cod_cliente INT = 2185;              -- CAMBIAR
DECLARE @nro_lugar_entrega INT = 1;          -- CAMBIAR


/* ============================================================
   VENTA
   ============================================================ */

DECLARE @cod_item INT = 1;                   -- ITEM VENDIDO
DECLARE @cantidad DECIMAL(18,2) = 4;         -- CANTIDAD VENDIDA
DECLARE @precio DECIMAL(18,4) = 9000;       -- PRECIO UNITARIO


/* ============================================================
   MOVIMIENTO DE VACIOS
   ============================================================ */

DECLARE @cantidad_vacios DECIMAL(18,2) = 6;  -- CANTIDAD ITEM 5


/* ============================================================
   VARIABLES CALCULADAS
   ============================================================ */

DECLARE @importe DECIMAL(18,4);

SET @importe = @cantidad * @precio;


/* ============================================================
   1. VALIDAR DATOS
   ============================================================ */

IF @cantidad <= 0
BEGIN
    PRINT 'ERROR: La cantidad vendida debe ser mayor que 0.';
    RETURN;
END;


IF @precio < 0
BEGIN
    PRINT 'ERROR: El precio no puede ser negativo.';
    RETURN;
END;


/* ============================================================
   2. VALIDAR QUE NO EXISTA EL COMPROBANTE
   ============================================================ */

IF EXISTS
(
    SELECT 1
    FROM Ventas
    WHERE tipo_comprobante = 'CI'
      AND prefijo = 0
      AND numero = @numero
)
BEGIN

    PRINT 'ERROR: Ya existe una venta con comprobante CI 0 '
          + CAST(@numero AS VARCHAR(20));

    RETURN;

END;


IF EXISTS
(
    SELECT 1
    FROM MovFisicos
    WHERE tipo_comprobante = 'CI'
      AND prefijo_remito = 0
      AND numero_remito = @numero
)
BEGIN

    PRINT 'ERROR: Ya existe un movimiento físico con comprobante CI 0 '
          + CAST(@numero AS VARCHAR(20));

    RETURN;

END;


/* ============================================================
   3. INSERTAR TODO
   ============================================================ */

BEGIN TRY

    BEGIN TRANSACTION;


    /* --------------------------------------------------------
       VENTAS
       -------------------------------------------------------- */

    INSERT INTO Ventas
    (
        tipo_comprobante,
        prefijo,
        numero,
        fecha_operacion,
        cod_cliente,
        nro_lugar_entrega,
        fecha_vencimiento,
        tipo_facturacion,
        numero_ci
    )
    VALUES
    (
        'CI',
        0,
        @numero,
        @fecha,
        @cod_cliente,
        @nro_lugar_entrega,
        @fecha,
        3,
        @numero
    );


    /* --------------------------------------------------------
       VENTASITEMS
       -------------------------------------------------------- */

    INSERT INTO VentasItems
    (
        tipo_comprobante,
        prefijo,
        numero,
        orden,
        cod_item,
        cantidad,
        precio,
        importe,
        tasa_iva,
        litros_abonados
    )
    VALUES
    (
        'CI',
        0,
        @numero,
        1,
        @cod_item,
        @cantidad,
        @precio,
        @importe,
        21,
        0
    );


    /* --------------------------------------------------------
       MOVFISICOS
       -------------------------------------------------------- */

    INSERT INTO MovFisicos
    (
        tipo_comprobante,
        prefijo_remito,
        numero_remito,
        fecha_remito,
        cod_cliente,
        nro_lugar_entrega
    )
    VALUES
    (
        'CI',
        0,
        @numero,
        @fecha,
        @cod_cliente,
        @nro_lugar_entrega
    );


    /* --------------------------------------------------------
       MOVFISICOSITEMS - ITEM LLENO
       -------------------------------------------------------- */

    INSERT INTO MovFisicosItems
    (
        tipo_comprobante,
        prefijo_remito,
        numero_remito,
        nro_orden,
        cod_item,
        cantidad,
        fecha_periodo_abono
    )
    VALUES
    (
        'CI',
        0,
        @numero,
        1,
        @cod_item,
        @cantidad,
        NULL
    );


    /* --------------------------------------------------------
       MOVFISICOSITEMS - ITEM 5 / VACIOS
       -------------------------------------------------------- */

    IF @cantidad_vacios <> 0
    BEGIN

        INSERT INTO MovFisicosItems
        (
            tipo_comprobante,
            prefijo_remito,
            numero_remito,
            nro_orden,
            cod_item,
            cantidad,
            fecha_periodo_abono
        )
        VALUES
        (
            'CI',
            0,
            @numero,
            2,
            5,
            -ABS(@cantidad_vacios),
            NULL
        );

    END;


    COMMIT TRANSACTION;

END TRY
BEGIN CATCH

    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;

    THROW;

END CATCH;


/* ============================================================
   4. MOSTRAR LO INSERTADO
   ============================================================ */

SELECT
    tipo_comprobante,
    prefijo,
    numero,
    fecha_operacion,
    cod_cliente,
    nro_lugar_entrega,
    fecha_vencimiento,
    tipo_facturacion,
    numero_ci
FROM Ventas
WHERE tipo_comprobante = 'CI'
  AND prefijo = 0
  AND numero = @numero;


SELECT
    tipo_comprobante,
    prefijo,
    numero,
    orden,
    cod_item,
    cantidad,
    precio,
    importe,
    tasa_iva,
    litros_abonados
FROM VentasItems
WHERE tipo_comprobante = 'CI'
  AND prefijo = 0
  AND numero = @numero
ORDER BY orden;


SELECT
    tipo_comprobante,
    prefijo_remito,
    numero_remito,
    fecha_remito,
    cod_cliente,
    nro_lugar_entrega
FROM MovFisicos
WHERE tipo_comprobante = 'CI'
  AND prefijo_remito = 0
  AND numero_remito = @numero;


SELECT
    tipo_comprobante,
    prefijo_remito,
    numero_remito,
    nro_orden,
    cod_item,
    cantidad,
    fecha_periodo_abono
FROM MovFisicosItems
WHERE tipo_comprobante = 'CI'
  AND prefijo_remito = 0
  AND numero_remito = @numero
ORDER BY nro_orden;