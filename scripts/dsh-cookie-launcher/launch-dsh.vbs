Option Explicit
Dim sh, fso, base, python, cleanup, exe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\dsh-mcviseron"
python = "D:\Python\Python312\python.exe"
If Not fso.FileExists(python) Then python = "python.exe"
cleanup = base & "\clean-dsh-auth-cookies.py"
If fso.FileExists(cleanup) Then
  On Error Resume Next
  sh.Run """" & python & """ """ & cleanup & """", 0, True
  On Error GoTo 0
End If
exe = "D:\DeepSeek Harness\DeepSeek Harness.exe"
sh.CurrentDirectory = "D:\DeepSeek Harness"
sh.Run """" & exe & """", 1, False
