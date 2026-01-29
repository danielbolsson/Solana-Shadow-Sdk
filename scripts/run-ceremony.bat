@echo off
REM Shadow Privacy - Trusted Setup Ceremony Runner (Windows)

setlocal EnableDelayedExpansion

echo ============================================
echo Shadow Privacy - Trusted Setup Ceremony
echo ============================================
echo.

set CIRCUITS_DIR=..\circuits
set BUILD_DIR=..\circuits\build
set CEREMONY_DIR=.\ceremony

REM Create ceremony directory
if not exist "%CEREMONY_DIR%" mkdir "%CEREMONY_DIR%"
cd "%CEREMONY_DIR%"

echo ========================================
echo Phase 1: Powers of Tau
echo ========================================
echo.

REM Check if starting fresh
if not exist "pot20_0000.ptau" (
    echo Initializing Powers of Tau...
    call snarkjs powersoftau new bn128 20 pot20_0000.ptau -v
    echo [OK] Initialized pot20_0000.ptau
) else (
    echo [INFO] Found existing pot20_0000.ptau
)

echo.
echo Participant Contributions
echo --------------------------
echo.

set /p NUM_PARTICIPANTS="How many participants? "

set CURRENT_PTAU=pot20_0000.ptau

for /l %%i in (1,1,%NUM_PARTICIPANTS%) do (
    set /a NEXT_NUM=%%i
    set NEXT_PTAU=pot20_000!NEXT_NUM!.ptau

    echo.
    echo Participant %%i contribution...

    call snarkjs powersoftau contribute "!CURRENT_PTAU!" "!NEXT_PTAU!" --name="Participant %%i" -v

    call snarkjs powersoftau verify "!NEXT_PTAU!"

    set CURRENT_PTAU=!NEXT_PTAU!
)

echo.
echo Applying Random Beacon
echo ----------------------
echo.

set /p BEACON="Enter beacon value (64 hex chars): "

call snarkjs powersoftau beacon "!CURRENT_PTAU!" pot20_beacon.ptau "!BEACON!" 10 -n="Final Beacon"

echo.
echo Preparing for Phase 2...
call snarkjs powersoftau prepare phase2 pot20_beacon.ptau pot20_final.ptau -v

echo.
echo Verifying final Powers of Tau...
call snarkjs powersoftau verify pot20_final.ptau

echo.
echo [OK] Phase 1 complete!
echo.

REM Phase 2 - Transfer Circuit
echo ========================================
echo Phase 2: Transfer Circuit
echo ========================================
echo.

call snarkjs groth16 setup "%CIRCUITS_DIR%\transfer.r1cs" pot20_final.ptau transfer_0000.zkey

set CURRENT_ZKEY=transfer_0000.zkey

for /l %%i in (1,1,%NUM_PARTICIPANTS%) do (
    set /a NEXT_NUM=%%i
    set NEXT_ZKEY=transfer_000!NEXT_NUM!.zkey

    echo Participant %%i contributing to transfer circuit...

    call snarkjs zkey contribute "!CURRENT_ZKEY!" "!NEXT_ZKEY!" --name="Participant %%i Transfer" -v

    set CURRENT_ZKEY=!NEXT_ZKEY!
)

call snarkjs zkey beacon "!CURRENT_ZKEY!" transfer_beacon.zkey "!BEACON!" 10 -n="Transfer Final Beacon"

call snarkjs zkey verify "%CIRCUITS_DIR%\transfer.r1cs" pot20_final.ptau transfer_beacon.zkey

call snarkjs zkey export verificationkey transfer_beacon.zkey transfer_verification_key.json

move /y transfer_beacon.zkey transfer_final.zkey

echo [OK] Transfer circuit complete!

REM Phase 2 - Balance Circuit
echo.
echo ========================================
echo Phase 2: Balance Circuit
echo ========================================
echo.

call snarkjs groth16 setup "%CIRCUITS_DIR%\balance.r1cs" pot20_final.ptau balance_0000.zkey

set CURRENT_ZKEY=balance_0000.zkey

for /l %%i in (1,1,%NUM_PARTICIPANTS%) do (
    set /a NEXT_NUM=%%i
    set NEXT_ZKEY=balance_000!NEXT_NUM!.zkey

    echo Participant %%i contributing to balance circuit...

    call snarkjs zkey contribute "!CURRENT_ZKEY!" "!NEXT_ZKEY!" --name="Participant %%i Balance" -v

    set CURRENT_ZKEY=!NEXT_ZKEY!
)

call snarkjs zkey beacon "!CURRENT_ZKEY!" balance_beacon.zkey "!BEACON!" 10 -n="Balance Final Beacon"

call snarkjs zkey verify "%CIRCUITS_DIR%\balance.r1cs" pot20_final.ptau balance_beacon.zkey

call snarkjs zkey export verificationkey balance_beacon.zkey balance_verification_key.json

move /y balance_beacon.zkey balance_final.zkey

echo [OK] Balance circuit complete!

REM Phase 2 - Ring Signature Circuit
echo.
echo ========================================
echo Phase 2: Ring Signature Circuit
echo ========================================
echo.

call snarkjs groth16 setup "%CIRCUITS_DIR%\ring_signature.r1cs" pot20_final.ptau ring_sig_0000.zkey

set CURRENT_ZKEY=ring_sig_0000.zkey

for /l %%i in (1,1,%NUM_PARTICIPANTS%) do (
    set /a NEXT_NUM=%%i
    set NEXT_ZKEY=ring_sig_000!NEXT_NUM!.zkey

    echo Participant %%i contributing to ring signature circuit...

    call snarkjs zkey contribute "!CURRENT_ZKEY!" "!NEXT_ZKEY!" --name="Participant %%i Ring Sig" -v

    set CURRENT_ZKEY=!NEXT_ZKEY!
)

call snarkjs zkey beacon "!CURRENT_ZKEY!" ring_sig_beacon.zkey "!BEACON!" 10 -n="Ring Sig Final Beacon"

call snarkjs zkey verify "%CIRCUITS_DIR%\ring_signature.r1cs" pot20_final.ptau ring_sig_beacon.zkey

call snarkjs zkey export verificationkey ring_sig_beacon.zkey ring_signature_verification_key.json

move /y ring_sig_beacon.zkey ring_sig_final.zkey

echo [OK] Ring signature circuit complete!

echo.
echo ========================================
echo Ceremony Complete!
echo ========================================
echo.
echo Final Parameters:
echo   Powers of Tau:    pot20_final.ptau
echo   Transfer Circuit: transfer_final.zkey
echo   Balance Circuit:  balance_final.zkey
echo   Ring Sig Circuit: ring_sig_final.zkey
echo.

set /p COPY_KEYS="Copy keys to build directory? (y/n): "

if /i "%COPY_KEYS%"=="y" (
    echo Copying keys to %BUILD_DIR%...
    copy /y transfer_final.zkey "%BUILD_DIR%\transfer_final.zkey"
    copy /y transfer_verification_key.json "%BUILD_DIR%\transfer_verification_key.json"
    copy /y balance_final.zkey "%BUILD_DIR%\balance_final.zkey"
    copy /y balance_verification_key.json "%BUILD_DIR%\balance_verification_key.json"
    copy /y ring_sig_final.zkey "%BUILD_DIR%\ring_signature_final.zkey"
    copy /y ring_signature_verification_key.json "%BUILD_DIR%\ring_signature_verification_key.json"
    echo [OK] Keys copied!
)

echo.
echo Ceremony complete!
echo.
echo Next steps:
echo 1. Upload verification keys to Solana
echo 2. Publish ceremony artifacts
echo 3. Collect participant attestations
echo.

pause
