@echo off
chcp 936 >nul 2>nul
title COC跑团记录簿 - 跑测试并打包安装包
setlocal

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=C:\coc-dev\COC-CHATGPT"

if not exist "%TARGET%\package.json" (
  echo.
  echo [错误] 没有找到项目目录：%TARGET%
  echo        可以把项目文件夹直接拖到这个脚本上再松手。
  echo.
  pause
  exit /b 1
)

cd /d "%TARGET%"
echo 1/3 安装依赖...
call pnpm install
if errorlevel 1 goto fail

echo.
echo 2/3 运行全部测试...
call pnpm test
if errorlevel 1 goto fail

echo.
echo 3/3 打包安装包，这一步比较慢，请耐心等...
call pnpm package:setup
if errorlevel 1 goto fail

echo.
echo 打包完成，安装包在下面这个目录里：
dir /b "%TARGET%\dist\*Setup.exe"
echo.
start "" "%TARGET%\dist"
pause
exit /b 0

:fail
echo.
echo [错误] 这一步失败了，请把本窗口截图发给我。
echo.
pause
exit /b 1
