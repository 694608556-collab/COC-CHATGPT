@echo off
chcp 936 >nul 2>nul
title COC跑团记录簿 - 跑测试并打包
setlocal

set "TARGET=%~1"
rem 默认操作本脚本所在的仓库（tools 的上一级），换电脑或改文件夹名都不用再改脚本。
if "%TARGET%"=="" for %%I in ("%~dp0..") do set "TARGET=%%~fI"

if not exist "%TARGET%\package.json" (
  echo.
  echo [错误] 没有找到项目目录：%TARGET%
  echo        可以把项目文件夹直接拖到这个脚本上再松手。
  echo.
  pause
  exit /b 1
)

cd /d "%TARGET%"
echo 1/4 安装依赖...
call pnpm install
if errorlevel 1 goto fail

echo.
echo 2/4 先构建一次（测试要读 out 目录里的构建产物）...
call pnpm build
if errorlevel 1 goto fail

echo.
echo 3/4 运行全部测试...
call pnpm test
if errorlevel 1 goto fail

echo.
echo 4/4 打包，这一步比较慢，请耐心等...
call pnpm package
if errorlevel 1 goto fail

echo.
echo 打包完成，两个文件都在下面这个目录里：
echo   *-win-x64.exe          免安装版，双击即用，数据存在程序旁边
echo   *-Windows-x64-Setup.exe  安装包，走安装向导，可自选安装位置
dir /b "%TARGET%\dist\*.exe"
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
