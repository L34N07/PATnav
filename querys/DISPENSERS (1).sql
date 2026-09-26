SELECT TOP (1000) [cod_dispenser]
      ,[marca]
      ,[estado]
      ,[ubicacion]
      ,[cod_cliente]
      ,[nro_lugar_entrega]
      ,[cod_abono_o_alquiler]
      ,[MControl_dispenser]
      ,[MControl2]
  FROM [NAVIERA].[dbo].[Dispenser]
  --WHERE cod_dispenser = 1234
  --where cod_cliente = 3040
  WHERE cod_dispenser = 171 OR cod_dispenser = 1047 OR cod_cliente = 266336
  --where cod_cliente = 104


  UPDATE Dispenser
  SET cod_cliente = 3041, nro_lugar_entrega = 1, cod_abono_o_alquiler = 13, MControl2 = 'S', ubicacion = '08/26'
  where cod_dispenser = 977

  UPDATE Dispenser
  SET cod_cliente = NULL, nro_lugar_entrega = NULL, cod_abono_o_alquiler = NULL, MControl2 = NULL
  WHERE cod_dispenser = 1142