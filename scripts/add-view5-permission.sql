IF COL_LENGTH('dbo.Nav_App_Users', 'View5') IS NULL
BEGIN
    ALTER TABLE dbo.Nav_App_Users
    ADD View5 bit NOT NULL CONSTRAINT DF_Nav_App_Users_View5 DEFAULT (0);
END
GO

CREATE OR ALTER PROCEDURE [dbo].[update_user_permission]
    @userID int,
    @testView bit,
    @testView2 bit,
    @View3 bit,
    @View4 bit,
    @View5 bit
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.Nav_App_Users
    SET testView = @testView,
        testView2 = @testView2,
        View3 = @View3,
        View4 = @View4,
        View5 = @View5
    WHERE appUserID = @userID;
END
GO
