@echo off
echo ============================================
echo  Music Organizer - Setup and Run
echo ============================================
echo.

REM Check Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install from https://python.org
    pause
    exit /b 1
)

REM Install mutagen if needed
echo Installing mutagen...
pip install mutagen -q

echo.
echo Running organizer in DRY RUN mode first...
echo (No files will be moved yet - just shows the plan)
echo.
python organize_music.py

echo.
echo ============================================
echo  Review the plan above.
echo  To actually move files:
echo    1. Open organize_music.py in Notepad
echo    2. Change:  DRY_RUN = True
echo           to:  DRY_RUN = False
echo    3. Run this .bat file again
echo ============================================
pause
