; Venise installer (Inno Setup 6).
; Build the portable folder first (npm run build), then compile this with ISCC.exe.
; It installs Venise for the current user (no admin prompt), adds Start menu and
; desktop shortcuts, and can add Venise to "Open with" for .lua files.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{178719CB-C8F1-4E28-8122-B19D463D9803}
AppName=Venise
AppVersion={#AppVersion}
AppVerName=Venise {#AppVersion}
AppPublisher=Venise
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\Venise
DefaultGroupName=Venise
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\release\installer
OutputBaseFilename=VeniseSetup
SetupIconFile=..\dist\venise.ico
UninstallDisplayIcon={app}\Venise.exe
UninstallDisplayName=Venise
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
ChangesAssociations=yes
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "openwith"; Description: "Add Venise to ""Open with"" for .lua files"; GroupDescription: "File types:"

[Files]
Source: "..\release\portable\Venise\Venise.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\release\portable\Venise\resources.neu"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\release\portable\Venise\README.txt"; DestDir: "{app}"; Flags: ignoreversion
; Starter files for the Data folder. Never overwritten on update, and kept on uninstall,
; so your own scripts and images are safe.
Source: "..\release\portable\Venise\Data\*"; DestDir: "{app}\Data"; Flags: recursesubdirs createallsubdirs onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{autoprograms}\Venise"; Filename: "{app}\Venise.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Venise"; Filename: "{app}\Venise.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKA; Subkey: "Software\Classes\.lua\OpenWithProgids"; ValueType: string; ValueName: "Venise.LuaScript"; ValueData: ""; Flags: uninsdeletevalue; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Venise.LuaScript"; ValueType: string; ValueName: ""; ValueData: "Lua script"; Flags: uninsdeletekey; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Venise.LuaScript\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\Venise.exe,0"; Tasks: openwith
Root: HKA; Subkey: "Software\Classes\Venise.LuaScript\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\Venise.exe"" ""%1"""; Tasks: openwith

[Run]
Filename: "{app}\Venise.exe"; Description: "Launch Venise"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent
