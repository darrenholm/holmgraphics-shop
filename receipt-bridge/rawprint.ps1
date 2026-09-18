# receipt-bridge/rawprint.ps1
#
# Sends a file to a Windows print queue as RAW — the bytes reach the printer
# untouched.
#
# This matters more than it looks. A receipt is an ESC/POS byte stream: the
# text, the paper cut, and the pulse that opens the cash drawer are all codes
# inside it. Anything that "prints" it the normal way (Out-Printer, a driver,
# Notepad) re-renders it as a picture of text — the cut and the drawer pulse
# are silently lost, and the receipt comes out as gibberish besides.
#
# Windows has no built-in cmdlet for raw spooling, so this calls winspool.drv
# the way a printer driver would: StartDocPrinter with the "RAW" datatype,
# then WritePrinter.

param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) { throw "File not found: $Path" }

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class HgRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void SendFile(string printerName, string path)
    {
        byte[] bytes = File.ReadAllBytes(path);
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("Could not open printer '" + printerName + "': " + Marshal.GetLastWin32Error());

        IntPtr unmanaged = IntPtr.Zero;
        try
        {
            DOCINFO di = new DOCINFO();
            di.pDocName  = "Holm Graphics receipt";
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, di))
                throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter failed: " + Marshal.GetLastWin32Error());
                try
                {
                    unmanaged = Marshal.AllocCoTaskMem(bytes.Length);
                    Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
                    int written;
                    if (!WritePrinter(hPrinter, unmanaged, bytes.Length, out written))
                        throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
                    if (written != bytes.Length)
                        throw new Exception("Short write: " + written + " of " + bytes.Length + " bytes");
                }
                finally { EndPagePrinter(hPrinter); }
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally
        {
            if (unmanaged != IntPtr.Zero) Marshal.FreeCoTaskMem(unmanaged);
            ClosePrinter(hPrinter);
        }
    }
}
'@

[HgRawPrinter]::SendFile($PrinterName, $Path)
Write-Output "ok"
