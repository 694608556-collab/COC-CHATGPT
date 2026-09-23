@echo off
chcp 936 >nul 2>nul
title COC跑团记录簿 - 提交并推送到 GitHub
setlocal

set "TARGET=%~1"
rem 默认操作本脚本所在的仓库（tools 的上一级），换电脑或改文件夹名都不用再改脚本。
if "%TARGET%"=="" for %%I in ("%~dp0..") do set "TARGET=%%~fI"

if not exist "%TARGET%\.git" (
  echo.
  echo [错误] 没有找到项目目录：%TARGET%
  echo        可以把项目文件夹直接拖到这个脚本上再松手。
  echo.
  pause
  exit /b 1
)

cd /d "%TARGET%"
echo ==========================================================
echo    正在提交并推送 %TARGET%
echo ==========================================================
echo.

git status --porcelain > "%TEMP%\coc-dirty.txt"
for %%A in ("%TEMP%\coc-dirty.txt") do if %%~zA GTR 0 goto commit
echo 没有需要提交的改动，直接推送当前分支。
goto push

:commit
echo 本次要提交的改动：
git status --short
echo.
git add -A
git -c user.name=Codex -c user.email=codex-local@example.com commit -m "公司电脑开发进度 %date% %time%"
if errorlevel 1 (
  echo.
  echo [错误] 提交失败，请把本窗口截图发给我。
  pause
  exit /b 1
)

:push
echo.
echo 正在推送到 GitHub...
git push origin HEAD
if errorlevel 1 (
  echo.
  echo 推送失败，通常是网络问题。等一会儿再运行一次本脚本即可。
  echo.
  pause
  exit /b 1
)
echo.
echo 推送成功，这台电脑上的进度已经保存到 GitHub。
git log --oneline -1
echo.
pause
exit /b 0
