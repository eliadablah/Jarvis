Unicode true
!include "MUI2.nsh"
Name "Jarvis"
OutFile "release\Jarvis-Setup-0.1.0.exe"
InstallDir "$LOCALAPPDATA\Programs\Jarvis"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Jarvis"
!define MUI_ICON "assets\jarvis.ico"
!define MUI_UNICON "assets\jarvis.ico"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "Jarvis"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "release\win-unpacked\*"
  WriteUninstaller "$INSTDIR\Uninstall Jarvis.exe"
  CreateShortCut "$SMPROGRAMS\Jarvis.lnk" "$INSTDIR\Jarvis.exe"
  CreateShortCut "$DESKTOP\Jarvis.lnk" "$INSTDIR\Jarvis.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "DisplayName" "Jarvis"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "Publisher" "Elikem Adablah"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "DisplayIcon" "$INSTDIR\Jarvis.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "UninstallString" '$\"$INSTDIR\Uninstall Jarvis.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "QuietUninstallString" '$\"$INSTDIR\Uninstall Jarvis.exe$\" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "NoRepair" 1
SectionEnd
Function .onInstSuccess
  Exec '$\"$INSTDIR\Jarvis.exe$\" --diagnostics'
FunctionEnd
Section "Uninstall"
  SetShellVarContext current
  ; Never recursively remove a computed directory outside this application's
  ; fixed per-user installation directory. Preserve all worker/userData files.
  StrCmp "$INSTDIR" "$LOCALAPPDATA\Programs\Jarvis" uninstall_valid uninstall_invalid
  uninstall_invalid:
    MessageBox MB_ICONSTOP "Jarvis uninstall path is unexpected. No files were removed."
    Abort
  uninstall_valid:
    IfFileExists "$INSTDIR\Jarvis.exe" 0 uninstall_invalid
    Delete "$SMPROGRAMS\Jarvis.lnk"
    Delete "$DESKTOP\Jarvis.lnk"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis"
    RMDir /r "$INSTDIR"
SectionEnd
