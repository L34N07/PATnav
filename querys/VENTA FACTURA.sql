/* ============================================================
   CARGA DE VENTA + VENTASITEMS
   + MOVFISICOS + MOVFISICOSITEMS

   TIPO COMPROBANTE, PREFIJO Y PRECIO MANUALES

   MOVIMIENTO FISICO:
   ITEM VENDIDO = LLENO
   ITEM 5 = VACIOS
   ============================================================ */

SET XACT_ABORT ON;


/* ============================================================
   DATOS A INGRESAR
   ============================================================ */

DECLARE @tipo_comprobante VARCHAR(2) = 'FA'; -- CAMBIAR
DECLARE @prefijo INT = 8;                    -- CAMBIAR
DECLARE @numero INT = 14452;                -- CAMBIAR
DECLARE @fecha DATE = '2026-08-24';          -- CAMBIAR
DECLARE @cod_cliente INT = 154;             -- CAMBIAR
DECLARE @nro_lugar_entrega INT = 2;          -- CAMBIAR


/* ============================================================
   VENTA
   ============================================================ */

DECLARE @cod_item INT = 1;                   -- ITEM VENDIDO
DECLARE @cantidad DECIMAL(18,2) = 1;         -- CANTIDAD
DECLARE @precio DECIMAL(18,4) = 9000;     -- PRECIO MANUAL


/* ============================================================
   MOVIMIENTO DE VACIOS
   ============================================================ */

DECLARE @cantidad_vacios DECIMAL(18,2) = 1;


/* ============================================================
   VARIABLES CALCULADAS
   ============================================================ */

DECLARE @importe DECIMAL(18,4);

SET @importe = @cantidad * @precio;


/* ============================================================
   1. VALIDAR QUE NO EXISTA EL COMPROBANTE
   ============================================================ */

IF EXISTS
(
    SELECT 1
    FROM Ventas
    WHERE tipo_comprobante = @tipo_comprobante
      AND prefijo = @prefijo
      AND numero = @numero
)
BEGIN
    PRINT 'ERROR: Ya existe una venta con comprobante '
          + @tipo_comprobante + ' '
          + CAST(@prefijo AS VARCHAR(10)) + ' '
          + CAST(@numero AS VARCHAR(20));

    RETURN;
END;


IF EXISTS
(
    SELECT 1
    FROM MovFisicos
    WHERE tipo_comprobante = @tipo_comprobante
      AND prefijo_remito = @prefijo
      AND numero_remito = @numero
)
BEGIN
    PRINT 'ERROR: Ya existe un movimiento físico con comprobante '
          + @tipo_comprobante + ' '
          + CAST(@prefijo AS VARCHAR(10)) + ' '
          + CAST(@numero AS VARCHAR(20));

    RETURN;
END;


/* ============================================================
   2. INSERTAR TODO
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
        @tipo_comprobante,
        @prefijo,
        @numero,
        @fecha,
        @cod_cliente,
        @nro_lugar_entrega,
        @fecha,
        3,
        @numero
    );


    /* --------------------------------------------------------
       VENTAS ITEMS
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
        @tipo_comprobante,
        @prefijo,
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
        @tipo_comprobante,
        @prefijo,
        @numero,
        @fecha,
        @cod_cliente,
        @nro_lugar_entrega
    );


    /* --------------------------------------------------------
       MOVFISICOSITEMS - ITEM VENDIDO / LLENO
       -------------------------------------------------------- */

    IF @cantidad <> 0
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
            @tipo_comprobante,
            @prefijo,
            @numero,
            1,
            @cod_item,
            @cantidad,
            NULL
        );

    END;


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
            @tipo_comprobante,
            @prefijo,
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
   3. MOSTRAR LO INSERTADO
   ============================================================ */

SELECT *
FROM Ventas
WHERE tipo_comprobante = @tipo_comprobante
  AND prefijo = @prefijo
  AND numero = @numero;


SELECT *
FROM VentasItems
WHERE tipo_comprobante = @tipo_comprobante
  AND prefijo = @prefijo
  AND numero = @numero
ORDER BY orden;


SELECT *
FROM MovFisicos
WHERE tipo_comprobante = @tipo_comprobante
  AND prefijo_remito = @prefijo
  AND numero_remito = @numero;


SELECT *
FROM MovFisicosItems
WHERE tipo_comprobante = @tipo_comprobante
  AND prefijo_remito = @prefijo
  AND numero_remito = @numero
ORDER BY nro_orden;