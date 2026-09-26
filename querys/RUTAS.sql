SELECT TOP (1000) [cod_ruta]
      ,[orden_circuito]
      ,[cod_cliente]
      ,[nro_lugar_entrega]
      ,[tipo_vendedor]E
      ,[L-Entrega]
      ,[L-Cobro]
      ,[DIA]
  FROM [NAVIERA].[dbo].[Circuito]
  WHERE cod_ruta = '1S'
  order by orden_circuito

  SELECT TOP (1000) [cod_ruta]
      ,[orden_circuito]
      ,[cod_cliente]
      ,[nro_lugar_entrega]
      ,[tipo_vendedor]
      ,[L-Entrega]
      ,[L-Cobro]
      ,[DIA]
  FROM [NAVIERA].[dbo].[Circuito]
  WHERE cod_cliente = 2738--cod_cliente = 2858
  order by orden_circuito

    SELECT TOP (1000) [cod_ruta]
      ,[orden_circuito]
      ,[cod_cliente]
      ,[nro_lugar_entrega]
      ,[tipo_vendedor]
      ,[L-Entrega]
      ,[L-Cobro]
      ,[DIA]
  FROM [NAVIERA].[dbo].[Circuito]
  WHERE cod_cliente = 2885
  order by orden_circuito

  UPDATE Circuito 
  SET cod_ruta = '2L', orden_circuito = 167
  WHERE cod_cliente = 2858 and nro_lugar_entrega = 1

  INSERT INTO Circuito (cod_ruta, orden_circuito, cod_cliente, nro_lugar_entrega, [L-Entrega],[L-Cobro])
  VALUES ('1M', 356, 3047, 1, 'S', 'S')