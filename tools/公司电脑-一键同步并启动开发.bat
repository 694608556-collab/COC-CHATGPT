@echo off
chcp 936 >nul 2>nul
title COC跑团记录簿 - 同步最新源码并启动开发
setlocal

set "REPO=https://github.com/694608556-collab/COC-CHATGPT.git"
set "BRANCH=v0.7.1"
set "TARGET=%~1"
rem 默认操作本脚本所在的仓库（tools 的上一级），换电脑或改文件夹名都不用再改脚本。
if "%TARGET%"=="" for %%I in ("%~dp0..") do set "TARGET=%%~fI"

where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 没有检测到 Git，请先安装 Git for Windows：
  echo        https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

if not exist "%TARGET%\.git" goto clone
goto update

:clone
echo.
echo 首次使用：正在把源码下载到 %TARGET%
echo.
git clone -b %BRANCH% "%REPO%" "%TARGET%"
if errorlevel 1 (
  echo.
  echo [错误] 下载失败，请检查网络后重试。
  echo.
  pause
  exit /b 1
)
goto start

:update
cd /d "%TARGET%"
echo.
echo 检查 %TARGET% 里有没有还没提交的改动...
git status --porcelain > "%TEMP%\coc-dirty.txt"
for %%A in ("%TEMP%\coc-dirty.txt") do if %%~zA GTR 0 goto dirty
echo 没有未提交改动，正在拉取 GitHub 上的最新进度...
git fetch origin
if errorlevel 1 goto network
git checkout %BRANCH%
git pull --ff-only origin %BRANCH%
if errorlevel 1 goto pullfail
goto start

:dirty
echo.
echo [提示] 这个文件夹里还有没提交的改动，为免覆盖你的工作，本次不自动拉取。
echo        请先运行「公司电脑-一键提交并推送.bat」，推送成功后再运行本脚本。
echo.
pause
exit /b 1

:network
echo.
echo [错误] 连接 GitHub 失败，请检查网络后重试。
echo.
pause
exit /b 1

:pullfail
echo.
echo [错误] 自动更新失败，需要人工处理，请把本窗口截图发给我。
echo.
pause
exit /b 1

:start
cd /d "%TARGET%"
echo.
echo ==========================================================
echo    当前进度
echo ==========================================================
git log --oneline -1
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js，请先安装 Node.js 22 或更新版本：
  echo        https://nodejs.org/zh-cn/download
  echo.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo 没有检测到 pnpm，正在自动安装...
  call npm install -g pnpm
  if errorlevel 1 (
    echo [错误] pnpm 安装失败，请把本窗口截图发给我。
    pause
    exit /b 1
  )
)

echo.
echo 正在安装依赖，第一次会比较慢（要下载 Electron），请耐心等...
call pnpm install
if errorlevel 1 (
  echo.
  echo [错误] 依赖安装失败，请把本窗口截图发给我。
  pause
  exit /b 1
)

echo.
echo 启动开发模式，应用窗口出现后就可以继续改界面和功能了。
echo 关闭应用窗口或按 Ctrl+C 即可结束。
echo.
call pnpm dev
pause
exit /b 0
