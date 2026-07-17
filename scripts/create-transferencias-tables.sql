SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.UsuariosTransferencia', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UsuariosTransferencia
    (
        id_usuario_transferencia int IDENTITY(1, 1) NOT NULL,
        cod_cliente numeric(4, 0) NULL,
        nro_lugar_entrega numeric(2, 0) NULL,
        cvu_cbu varchar(22) NULL,
        orden smallint NOT NULL,

        CONSTRAINT PK_UsuariosTransferencia
            PRIMARY KEY CLUSTERED (id_usuario_transferencia),
        CONSTRAINT FK_UsuariosTransferencia_LugarEntrega
            FOREIGN KEY (cod_cliente, nro_lugar_entrega)
            REFERENCES dbo.LugarEntrega (cod_cliente, nro_lugar_entrega),
        CONSTRAINT CK_UsuariosTransferencia_Propietario
            CHECK
            (
                (
                    cod_cliente IS NULL
                    AND nro_lugar_entrega IS NULL
                    AND cvu_cbu IS NULL
                    AND orden = 0
                )
                OR
                (
                    cod_cliente IS NOT NULL
                    AND nro_lugar_entrega IS NOT NULL
                    AND cvu_cbu IS NOT NULL
                    AND orden > 0
                )
            ),
        CONSTRAINT CK_UsuariosTransferencia_CvuCbu
            CHECK
            (
                cvu_cbu IS NULL
                OR (LEN(cvu_cbu) = 22 AND cvu_cbu NOT LIKE '%[^0-9]%')
            )
    );

    CREATE UNIQUE INDEX UX_UsuariosTransferencia_ClienteLugarOrden
        ON dbo.UsuariosTransferencia (cod_cliente, nro_lugar_entrega, orden);

    CREATE UNIQUE INDEX UX_UsuariosTransferencia_CvuCbu
        ON dbo.UsuariosTransferencia (cvu_cbu)
        WHERE cvu_cbu IS NOT NULL;
END;
GO

IF COL_LENGTH(N'dbo.UsuariosTransferencia', N'cod_cliente') IS NULL
   AND COL_LENGTH(N'dbo.UsuariosTransferencia', N'id_cliente') IS NOT NULL
BEGIN
    IF EXISTS
    (
        SELECT 1
        FROM sys.foreign_keys
        WHERE parent_object_id = OBJECT_ID(N'dbo.UsuariosTransferencia')
          AND name = N'FK_UsuariosTransferencia_LugarEntrega'
    )
        ALTER TABLE dbo.UsuariosTransferencia
        DROP CONSTRAINT FK_UsuariosTransferencia_LugarEntrega;

    IF EXISTS
    (
        SELECT 1
        FROM sys.check_constraints
        WHERE parent_object_id = OBJECT_ID(N'dbo.UsuariosTransferencia')
          AND name = N'CK_UsuariosTransferencia_Propietario'
    )
        ALTER TABLE dbo.UsuariosTransferencia
        DROP CONSTRAINT CK_UsuariosTransferencia_Propietario;

    IF EXISTS
    (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID(N'dbo.UsuariosTransferencia')
          AND name = N'UX_UsuariosTransferencia_ClienteLugarOrden'
    )
        DROP INDEX UX_UsuariosTransferencia_ClienteLugarOrden
        ON dbo.UsuariosTransferencia;

    EXEC sys.sp_rename
        N'dbo.UsuariosTransferencia.id_cliente',
        N'cod_cliente',
        N'COLUMN';
END;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.UsuariosTransferencia')
      AND name = N'FK_UsuariosTransferencia_LugarEntrega'
)
BEGIN
    ALTER TABLE dbo.UsuariosTransferencia WITH CHECK
    ADD CONSTRAINT FK_UsuariosTransferencia_LugarEntrega
        FOREIGN KEY (cod_cliente, nro_lugar_entrega)
        REFERENCES dbo.LugarEntrega (cod_cliente, nro_lugar_entrega);
END;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.UsuariosTransferencia')
      AND name = N'CK_UsuariosTransferencia_Propietario'
)
BEGIN
    ALTER TABLE dbo.UsuariosTransferencia WITH CHECK
    ADD CONSTRAINT CK_UsuariosTransferencia_Propietario
        CHECK
        (
            (
                cod_cliente IS NULL
                AND nro_lugar_entrega IS NULL
                AND cvu_cbu IS NULL
                AND orden = 0
            )
            OR
            (
                cod_cliente IS NOT NULL
                AND nro_lugar_entrega IS NOT NULL
                AND cvu_cbu IS NOT NULL
                AND orden > 0
            )
        );
END;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.UsuariosTransferencia')
      AND name = N'UX_UsuariosTransferencia_ClienteLugarOrden'
)
BEGIN
    CREATE UNIQUE INDEX UX_UsuariosTransferencia_ClienteLugarOrden
        ON dbo.UsuariosTransferencia (cod_cliente, nro_lugar_entrega, orden);
END;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.UsuariosTransferencia')
      AND name = N'UX_UsuariosTransferencia_CvuCbu'
)
BEGIN
    CREATE UNIQUE INDEX UX_UsuariosTransferencia_CvuCbu
        ON dbo.UsuariosTransferencia (cvu_cbu)
        WHERE cvu_cbu IS NOT NULL;
END;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM dbo.UsuariosTransferencia
    WHERE cod_cliente IS NULL
      AND nro_lugar_entrega IS NULL
      AND cvu_cbu IS NULL
      AND orden = 0
)
BEGIN
    INSERT INTO dbo.UsuariosTransferencia
    (
        cod_cliente,
        nro_lugar_entrega,
        cvu_cbu,
        orden
    )
    VALUES
    (
        NULL,
        NULL,
        NULL,
        0
    );
END;
GO

IF OBJECT_ID(N'dbo.Transferencias', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Transferencias
    (
        id_transferencia bigint IDENTITY(1, 1) NOT NULL,
        cvu_cbu varchar(22) NOT NULL,
        monto decimal(18, 2) NOT NULL,
        id_usuario_transferencia int NOT NULL,
        fecha datetime2(0) NOT NULL,
        nombre_asociado nvarchar(160) NULL,

        CONSTRAINT PK_Transferencias
            PRIMARY KEY CLUSTERED (id_transferencia),
        CONSTRAINT FK_Transferencias_UsuariosTransferencia
            FOREIGN KEY (id_usuario_transferencia)
            REFERENCES dbo.UsuariosTransferencia (id_usuario_transferencia),
        CONSTRAINT CK_Transferencias_CvuCbu
            CHECK (LEN(cvu_cbu) = 22 AND cvu_cbu NOT LIKE '%[^0-9]%'),
        CONSTRAINT CK_Transferencias_Monto
            CHECK (monto > 0)
    );

    CREATE INDEX IX_Transferencias_CvuCbu_Fecha
        ON dbo.Transferencias (cvu_cbu, fecha DESC);

    CREATE INDEX IX_Transferencias_Usuario_Fecha
        ON dbo.Transferencias (id_usuario_transferencia, fecha DESC);
END;
GO

IF COL_LENGTH(N'dbo.Transferencias', N'nombre_asociado') IS NULL
BEGIN
    ALTER TABLE dbo.Transferencias
    ADD nombre_asociado nvarchar(160) NULL;
END;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.Transferencias')
      AND name = N'IX_Transferencias_CvuCbu_Fecha'
)
BEGIN
    CREATE INDEX IX_Transferencias_CvuCbu_Fecha
        ON dbo.Transferencias (cvu_cbu, fecha DESC);
END;
GO

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.Transferencias')
      AND name = N'IX_Transferencias_Usuario_Fecha'
)
BEGIN
    CREATE INDEX IX_Transferencias_Usuario_Fecha
        ON dbo.Transferencias (id_usuario_transferencia, fecha DESC);
END;
GO

SELECT
    id_usuario_transferencia AS unidentified_user_id,
    orden
FROM dbo.UsuariosTransferencia
WHERE cod_cliente IS NULL
  AND nro_lugar_entrega IS NULL
  AND cvu_cbu IS NULL
  AND orden = 0;
GO
