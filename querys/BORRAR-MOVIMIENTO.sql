DECLARE @numero_remito INT = 465575;

BEGIN TRANSACTION;


/* 1. BORRAR ITEMS DEL COMPROBANTE */

DELETE FROM MovFisicosItems
WHERE tipo_comprobante = 'CI'
  AND prefijo_remito = 0
  AND numero_remito = @numero_remito;


/* 2. BORRAR MOVIMIENTO */

DELETE FROM MovFisicos
WHERE tipo_comprobante = 'CI'
  AND prefijo_remito = 0
  AND numero_remito = @numero_remito;


/* 3. CONFIRMAR EL BORRADO */

COMMIT TRANSACTION;