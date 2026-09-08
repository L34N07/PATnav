/* ============================================================
   CARGA DE COBRO + COBRO APLICADO

   Recibo: CI 0 NUMX
   ============================================================ */

SET XACT_ABORT ON;


/* ============================================================
   DATOS DEL COBRO
   ============================================================ */

DECLARE @numero_recibo INT = 465458;          -- CAMBIAR
DECLARE @fecha_recibo DATE = '2026-08-19';    -- CAMBIAR
DECLARE @cod_cliente INT = 2490;              -- CAMBIAR
DECLARE @nro_lugar_entrega INT = 1;           -- CAMBIAR


/* ============================================================
   COMPROBANTE QUE SE ESTA PAGANDO
   ============================================================ */

DECLARE @tipo_comprobante VARCHAR(10) = 'FB'; -- CAMBIAR
DECLARE @prefijo INT = 4;                     -- CAMBIAR
DECLARE @numero INT = 81297;                 -- CAMBIAR

DECLARE @importe_aplicado DECIMAL(18,2) = 36000; -- CAMBIAR


/* ============================================================
   1. COMPROBAR QUE EL RECIBO CI 0 NUMX NO EXISTA
   ============================================================ */

IF EXISTS
(
    SELECT 1
    FROM Cobros
    WHERE tipo_comprobante_cobro = 'CI'
      AND prefijo_recibo = 0
      AND numero_recibo = @numero_recibo
)
BEGIN

    PRINT 'ERROR: Ya existe el cobro CI 0 '
          + CAST(@numero_recibo AS VARCHAR(20));

    RETURN;

END;


/* También comprobamos que no exista un aplicado huérfano
   usando el mismo recibo */

IF EXISTS
(
    SELECT 1
    FROM CobrosAplicados
    WHERE tipo_comprobante_cobro = 'CI'
      AND prefijo_recibo = 0
      AND numero_recibo = @numero_recibo
)
BEGIN

    PRINT 'ERROR: Ya existen CobrosAplicados asociados al CI 0 '
          + CAST(@numero_recibo AS VARCHAR(20));

    RETURN;

END;


/* ============================================================
   2. VALIDAR IMPORTE
   ============================================================ */

IF @importe_aplicado <= 0
BEGIN

    PRINT 'ERROR: El importe aplicado debe ser mayor que 0.';

    RETURN;

END;


/* ============================================================
   3. INSERTAR COBRO + APLICACION
   ============================================================ */

BEGIN TRY

    BEGIN TRANSACTION;


    /* --------------------------------------------------------
       COBROS
       -------------------------------------------------------- */

    INSERT INTO Cobros
    (
        tipo_comprobante_cobro,
        prefijo_recibo,
        numero_recibo,
        fecha_recibo,
        cod_cliente,
        nro_lugar_entrega
    )
    VALUES
    (
        'CI',
        0,
        @numero_recibo,
        @fecha_recibo,
        @cod_cliente,
        @nro_lugar_entrega
    );


    /* --------------------------------------------------------
       COBROS APLICADOS
       -------------------------------------------------------- */

    INSERT INTO CobrosAplicados
    (
        tipo_comprobante_cobro,
        prefijo_recibo,
        numero_recibo,
        tipo_comprobante,
        prefijo,
        numero,
        importe_aplicado,
        numero_ci
    )
    VALUES
    (
        'CI',
        0,
        @numero_recibo,
        @tipo_comprobante,
        @prefijo,
        @numero,
        @importe_aplicado,
        @numero_recibo
    );


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
    tipo_comprobante_cobro,
    prefijo_recibo,
    numero_recibo,
    fecha_recibo,
    cod_cliente,
    nro_lugar_entrega,
    saca_c
FROM Cobros
WHERE tipo_comprobante_cobro = 'CI'
  AND prefijo_recibo = 0
  AND numero_recibo = @numero_recibo;


SELECT
    tipo_comprobante_cobro,
    prefijo_recibo,
    numero_recibo,
    tipo_comprobante,
    prefijo,
    numero,
    importe_aplicado,
    numero_ci,
    saca_ca
FROM CobrosAplicados
WHERE tipo_comprobante_cobro = 'CI'
  AND prefijo_recibo = 0
  AND numero_recibo = @numero_recibo;