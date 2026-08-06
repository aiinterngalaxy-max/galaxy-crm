@echo off
REM Invoked only by the "GalaxyCRM Backup" Windows scheduled task.
REM Sets GALAXY_SCHEDULED so BACKUP.bat skips the interactive pause.
set GALAXY_SCHEDULED=1
call "%~dp0BACKUP.bat"
