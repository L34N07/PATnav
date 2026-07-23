IF COL_LENGTH('dbo.Nav_App_Users', 'View8') IS NULL
BEGIN
    ALTER TABLE dbo.Nav_App_Users
    ADD View8 bit NOT NULL CONSTRAINT DF_Nav_App_Users_View8 DEFAULT (0);
END
GO

CREATE OR ALTER PROCEDURE [dbo].[update_user_permission]
    @userID int,
    @testView bit,
    @testView2 bit,
    @View3 bit,
    @View4 bit,
    @View5 bit,
    @View6 bit,
    @View7 bit,
    @View8 bit
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Nav_App_Users
    SET testView = @testView,
        testView2 = @testView2,
        View3 = @View3,
        View4 = @View4,
        View5 = @View5,
        View6 = @View6,
        View7 = @View7,
        View8 = @View8
    WHERE appUserID = @userID;
END
GO
