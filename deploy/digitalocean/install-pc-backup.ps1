$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskName = 'MLGW verified cloud backup'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument 'scripts/scheduled-backup.mjs' -WorkingDirectory $workspace
$triggers = @((New-ScheduledTaskTrigger -Daily -At '10:00'), (New-ScheduledTaskTrigger -AtLogOn -User $identity))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description 'Daily checksum-verified off-VM outage backup; catch up at login. Requires this PC online and user signed in.' -Force | Select-Object TaskName,State
