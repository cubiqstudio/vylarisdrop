<#
.SYNOPSIS
  VylarisCloud: Windows-WebDAV-Netzlaufwerk fuer grosse Dateien einrichten (WebClient-Dienst).
  VylarisCloud: set up the Windows WebDAV network drive for large files (WebClient service).

.DESCRIPTION
  Windows begrenzt Dateien auf WebDAV-Laufwerken von sich aus auf 50.000.000 Byte (ca. 48 MB), egal wie der Server
  eingestellt ist (Fehler 0x800700DF "Die Dateigroesse ueberschreitet das zulaessige Limit"). Dieses Skript
    1. hebt FileSizeLimitInBytes auf den Hoechstwert 4294967295 (knapp 4 GB) an,
    2. stellt sicher, dass die Basic-Anmeldung ueber HTTPS erlaubt ist (BasicAuthLevel mindestens 1, nie hoeher),
    3. stellt den Dienst "WebClient" auf Starttyp Automatisch und startet ihn neu, damit die Werte gelten.
  VORHER werden die alten Werte angezeigt und gesichert; mit -Rueckgaengig stellt das Skript sie wieder her.

  Was das Skript NICHT loest: Hinter einem Cloudflare-Tunnel/-Proxy (Tarife Free/Pro) begrenzt Cloudflare jede
  HTTP-Anfrage auf 100 MB. Ein WebDAV-Upload ist EINE Anfrage. Dafuer braucht es einen direkten Hostnamen, ein privates
  Netz (z. B. Tailscale) oder einen anderen Client - siehe deploy/README.md, Abschnitt "Grosse Dateien hinter Cloudflare".
  Ueber 4 GB kann der Windows-Explorer grundsaetzlich nicht (Grenze des WebDAV-Redirectors); dort rclone, WinSCP oder
  Cyberduck verwenden.

  BITTE VOR DEM AUSFUEHREN LESEN. Das Skript aendert nur die zwei Registry-Werte unter
  HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters und den Starttyp/Zustand des Dienstes WebClient.
  Es laedt nichts aus dem Internet und sendet nichts.

.PARAMETER Rueckgaengig
  Stellt die gesicherten alten Werte wieder her (--rueckgaengig geht ebenfalls).

.PARAMETER Trocken
  Zeigt nur an, was geaendert wuerde, und aendert nichts (--trocken geht ebenfalls). Braucht keine Administrator-Rechte.

.PARAMETER Ja
  Keine Rueckfrage (fuer Skripte). Ohne -Ja wird vor jeder Aenderung gefragt.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\windows-webdav.ps1 -Trocken
  powershell -ExecutionPolicy Bypass -File .\windows-webdav.ps1
  powershell -ExecutionPolicy Bypass -File .\windows-webdav.ps1 -Rueckgaengig
#>
[CmdletBinding()]
param(
  [switch]$Rueckgaengig,
  [switch]$Trocken,
  [switch]$Ja,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# Schalter im Stil "--rueckgaengig" / "--trocken" / "--ja" ebenfalls annehmen
foreach ($r in @($Rest)) {
  switch -Regex ($r) {
    '^--?r(ue|\u00fc)ckg(ae|\u00e4)ngig$' { $Rueckgaengig = [switch]$true }
    '^--?trocken$' { $Trocken = [switch]$true }
    '^--?ja$' { $Ja = [switch]$true }
    '^$' { }
    default { throw ("Unbekannte Option / unknown option: " + $r) }
  }
}

$RegPfad = 'HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\WebClient\Parameters'
$Standard = @{ FileSizeLimitInBytes = [uint64]50000000; BasicAuthLevel = [uint64]1 }
$Ziel = @{ FileSizeLimitInBytes = [uint64]4294967295 }
$SicherungOrdner = Join-Path $env:ProgramData 'VylarisCloud'
$SicherungDatei = Join-Path $SicherungOrdner 'webclient-vorher.json'

# Deutsch oder Englisch je nach Anzeigesprache von Windows
function T([string]$de, [string]$en) {
  if ((Get-UICulture).TwoLetterISOLanguageName -eq 'de') { return $de } else { return $en }
}

# --- Zugriff auf Registry und Dienst (in Funktionen, damit sich das Skript ohne Windows testen laesst) ---
function RegLesen([string]$name) {
  $v = [Microsoft.Win32.Registry]::GetValue($RegPfad, $name, $null)
  if ($null -eq $v) { return $null }
  # DWORD kommt als vorzeichenbehafteter Int32 zurueck; 0xFFFFFFFF ist hier -1
  return [uint64][BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$v), 0)
}
function RegSchreiben([string]$name, [uint64]$wert) {
  if ($wert -gt [uint64][uint32]::MaxValue) { throw 'Wert zu gross fuer DWORD' }
  $roh = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$wert), 0)
  [Microsoft.Win32.Registry]::SetValue($RegPfad, $name, $roh, [Microsoft.Win32.RegistryValueKind]::DWord)
}
function RegEntfernen([string]$name) {
  $schluessel = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Services\WebClient\Parameters', $true)
  if ($null -ne $schluessel) {
    try { $schluessel.DeleteValue($name, $false) } finally { $schluessel.Close() }
  }
}
function DienstLesen() {
  $d = Get-Service -Name WebClient -ErrorAction SilentlyContinue
  if ($null -eq $d) { return $null }
  return @{ Status = [string]$d.Status; Start = [string]$d.StartType }
}
function DienstStarttyp([string]$typ) { Set-Service -Name WebClient -StartupType $typ }
function DienstNeustart([bool]$laufen) {
  $d = Get-Service -Name WebClient
  if ($d.Status -ne 'Stopped') { Stop-Service -Name WebClient -Force }
  if ($laufen) { Start-Service -Name WebClient }
}
function IstAdmin() {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Zahl($w) { if ($null -eq $w) { return '-' } else { return ('{0:N0}' -f $w) } }
function WertText($w, $std) {
  if ($null -eq $w) { return ((Zahl $std) + (T ' (nicht gesetzt = Standard)' ' (not set = default)')) } else { return (Zahl $w) }
}
function Frage([string]$text) {
  if ($Ja) { return $true }
  $a = Read-Host ($text + (T ' [j/N]' ' [y/N]'))
  return ($a -match '^(j|ja|y|yes)$')
}

# Berechnet, was zu tun ist. Rueckgabe: Liste von Aenderungen (Name, Alt, Neu) und Hinweise.
function Plan($registerAlt, $dienstAlt) {
  $aend = @()
  $hinweise = @()
  $alt = $registerAlt['FileSizeLimitInBytes']
  $effektiv = if ($null -eq $alt) { $Standard['FileSizeLimitInBytes'] } else { $alt }
  if ($effektiv -lt $Ziel['FileSizeLimitInBytes']) {
    $aend += @{ Name = 'FileSizeLimitInBytes'; Alt = $alt; Neu = $Ziel['FileSizeLimitInBytes'] }
  }
  $basic = $registerAlt['BasicAuthLevel']
  $basicEff = if ($null -eq $basic) { $Standard['BasicAuthLevel'] } else { $basic }
  if ($basicEff -eq 0) {
    $aend += @{ Name = 'BasicAuthLevel'; Alt = $basic; Neu = [uint64]1 }
  } elseif ($basicEff -ge 2) {
    $hinweise += (T 'BasicAuthLevel ist 2 oder hoeher: Windows sendet Kennwoerter dann auch ueber unverschluesseltes http:// im Klartext. Das Skript laesst den Wert unveraendert; mit "BasicAuthLevel" = 1 waere nur https erlaubt.' 'BasicAuthLevel is 2 or higher: Windows then also sends passwords in clear text over plain http://. The script leaves it unchanged; 1 would allow https only.')
  }
  return @{ Aenderungen = $aend; Hinweise = $hinweise }
}

function Anzeigen($registerAlt, $dienstAlt, $plan) {
  Write-Host ''
  Write-Host (T 'Aktuelle Werte (WebClient):' 'Current values (WebClient):')
  Write-Host ('  FileSizeLimitInBytes : ' + (WertText $registerAlt['FileSizeLimitInBytes'] $Standard['FileSizeLimitInBytes']))
  Write-Host ('  BasicAuthLevel       : ' + (WertText $registerAlt['BasicAuthLevel'] $Standard['BasicAuthLevel']))
  if ($null -eq $dienstAlt) {
    Write-Host ('  Dienst WebClient     : ' + (T 'NICHT VORHANDEN' 'NOT PRESENT'))
  } else {
    Write-Host ('  Dienst WebClient     : ' + $dienstAlt['Status'] + ', Starttyp ' + $dienstAlt['Start'])
  }
  Write-Host ''
}

function Hauptprogramm() {
  Write-Host 'VylarisCloud - WebDAV unter Windows / WebDAV on Windows'
  $dienst = DienstLesen
  if ($null -eq $dienst) {
    Write-Host (T 'Der Dienst "WebClient" fehlt. Auf Windows Server zuerst das Feature "WebDAV-Redirector" installieren (Install-WindowsFeature WebDAV-Redirector) und neu starten.' 'The "WebClient" service is missing. On Windows Server install the "WebDAV-Redirector" feature first (Install-WindowsFeature WebDAV-Redirector) and restart.')
    return 1
  }
  $reg = @{ FileSizeLimitInBytes = (RegLesen 'FileSizeLimitInBytes'); BasicAuthLevel = (RegLesen 'BasicAuthLevel') }

  if (-not $Trocken -and -not (IstAdmin)) {
    Write-Host (T 'Dieses Skript braucht Administrator-Rechte. Starte PowerShell mit Rechtsklick -> "Als Administrator ausfuehren" und rufe das Skript erneut auf. (Mit -Trocken kannst du es ohne Administrator-Rechte nur ansehen.)' 'This script needs administrator rights. Start PowerShell with right-click -> "Run as administrator" and run it again. (With -Trocken you can just preview it without administrator rights.)')
    return 1
  }

  if ($Rueckgaengig) {
    Anzeigen $reg $dienst $null
    if (-not (Test-Path -LiteralPath $SicherungDatei)) {
      Write-Host (T 'Keine Sicherung gefunden - es gibt nichts rueckgaengig zu machen.' 'No backup found - nothing to undo.')
      return 0
    }
    $alt = Get-Content -LiteralPath $SicherungDatei -Raw | ConvertFrom-Json
    Write-Host ((T 'Wiederherzustellen (aus der Sicherung vom ' 'To restore (from the backup of ') + $alt.Datum + '):')
    foreach ($n in 'FileSizeLimitInBytes', 'BasicAuthLevel') {
      $w = $alt.Register.$n
      Write-Host ('  ' + $n + ' -> ' + $(if ($null -eq $w) { (T 'entfernen (Standard)' 'remove (default)') } else { Zahl $w }))
    }
    Write-Host ('  Dienst WebClient -> Starttyp ' + $alt.Dienst.Start + ', ' + $alt.Dienst.Status)
    if ($Trocken) { Write-Host (T 'Trockenlauf: nichts geaendert.' 'Dry run: nothing changed.'); return 0 }
    if (-not (Frage (T 'Jetzt wiederherstellen? Verbundene Netzlaufwerke werden kurz getrennt.' 'Restore now? Mapped network drives are disconnected briefly.'))) { Write-Host (T 'Abgebrochen.' 'Cancelled.'); return 2 }
    foreach ($n in 'FileSizeLimitInBytes', 'BasicAuthLevel') {
      $w = $alt.Register.$n
      if ($null -eq $w) { RegEntfernen $n } else { RegSchreiben $n ([uint64]$w) }
    }
    DienstStarttyp ([string]$alt.Dienst.Start)
    DienstNeustart ($alt.Dienst.Status -eq 'Running')
    Remove-Item -LiteralPath $SicherungDatei -Force
    Write-Host (T 'Fertig: der alte Zustand ist wiederhergestellt.' 'Done: the previous state is restored.')
    return 0
  }

  $plan = Plan $reg $dienst
  Anzeigen $reg $dienst $plan
  Write-Host (T 'Geplant:' 'Planned:')
  foreach ($a in $plan.Aenderungen) { Write-Host ('  ' + $a.Name + ' : ' + (Zahl $a.Alt) + ' -> ' + (Zahl $a.Neu)) }
  if ($dienst['Start'] -ne 'Automatic') { Write-Host ('  Dienst WebClient : ' + (T 'Starttyp ' 'start type ') + $dienst['Start'] + ' -> Automatic') }
  Write-Host ('  Dienst WebClient : ' + (T 'wird neu gestartet (Netzlaufwerke werden kurz getrennt)' 'is restarted (network drives are disconnected briefly)'))
  foreach ($h in $plan.Hinweise) { Write-Host ('  ! ' + $h) }
  if ($plan.Aenderungen.Count -eq 0 -and $dienst['Start'] -eq 'Automatic' -and $dienst['Status'] -eq 'Running') {
    Write-Host (T 'Alles ist schon so eingestellt - nichts zu tun.' 'Everything is already set up - nothing to do.')
  }
  Write-Host ''
  Write-Host (T 'Hinweis: Das hebt nur die Grenze von Windows an. Hinter Cloudflare (Free/Pro) gelten weiterhin 100 MB je Anfrage; ueber 4 GB geht der Explorer nie.' 'Note: this only raises the Windows limit. Behind Cloudflare (Free/Pro) 100 MB per request still applies; Explorer never goes beyond 4 GB.')
  if ($Trocken) { Write-Host (T 'Trockenlauf: nichts geaendert.' 'Dry run: nothing changed.'); return 0 }
  if (-not (Frage (T 'Jetzt aendern?' 'Apply now?'))) { Write-Host (T 'Abgebrochen.' 'Cancelled.'); return 2 }

  # Sicherung nur beim ersten Mal anlegen, damit ein zweiter Lauf die Originalwerte nicht ueberschreibt
  if (-not (Test-Path -LiteralPath $SicherungDatei)) {
    if (-not (Test-Path -LiteralPath $SicherungOrdner)) { New-Item -ItemType Directory -Path $SicherungOrdner -Force | Out-Null }
    $sich = @{
      Datum = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
      Register = @{ FileSizeLimitInBytes = $reg['FileSizeLimitInBytes']; BasicAuthLevel = $reg['BasicAuthLevel'] }
      Dienst = @{ Status = $dienst['Status']; Start = $dienst['Start'] }
    }
    ($sich | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $SicherungDatei -Encoding ASCII
    Write-Host ((T 'Alte Werte gesichert in ' 'Old values saved to ') + $SicherungDatei)
  }
  foreach ($a in $plan.Aenderungen) { RegSchreiben $a.Name ([uint64]$a.Neu) }
  DienstStarttyp 'Automatic'
  DienstNeustart $true
  $neu = @{ FileSizeLimitInBytes = (RegLesen 'FileSizeLimitInBytes'); BasicAuthLevel = (RegLesen 'BasicAuthLevel') }
  Write-Host ''
  Write-Host (T 'Neue Werte:' 'New values:')
  Write-Host ('  FileSizeLimitInBytes : ' + (WertText $neu['FileSizeLimitInBytes'] $Standard['FileSizeLimitInBytes']))
  Write-Host ('  BasicAuthLevel       : ' + (WertText $neu['BasicAuthLevel'] $Standard['BasicAuthLevel']))
  Write-Host (T 'Fertig. Das Netzlaufwerk bei Bedarf neu verbinden. Rueckgaengig: dieses Skript mit -Rueckgaengig aufrufen.' 'Done. Reconnect the network drive if needed. To undo: run this script with -Rueckgaengig.')
  return 0
}

# Beim "Dot-Sourcing" (. .\windows-webdav.ps1) laeuft nur die Funktionsdefinition, nicht das Hauptprogramm (fuer Tests)
if ($MyInvocation.InvocationName -ne '.') {
  try { $ergebnis = @(Hauptprogramm); exit [int]$ergebnis[-1] } catch { Write-Host ((T 'Fehler: ' 'Error: ') + $_.Exception.Message) -ForegroundColor Red; exit 1 }
}
