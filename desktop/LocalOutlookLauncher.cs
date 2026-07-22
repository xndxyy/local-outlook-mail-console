using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

internal static class LocalOutlookLauncher
{
    private const string InstallRoot = @"D:\LocalOutlookMailConsole";
    private const string MutexName = @"Local\LocalOutlookMailConsole.DesktopLauncher";

    [STAThread]
    private static void Main()
    {
        bool ownsMutex;

        using (var mutex = new Mutex(true, MutexName, out ownsMutex))
        {
            if (!ownsMutex)
            {
                return;
            }

            try
            {
                var appRoot = Path.Combine(InstallRoot, "app");
                var nodePath = Path.Combine(appRoot, "runtime", "node.exe");
                var launcherPath = Path.Combine(appRoot, "desktop", "launch-app.mjs");

                if (!File.Exists(nodePath) || !File.Exists(launcherPath))
                {
                    MessageBox.Show(
                        "D drive application files are missing. Expected: " + appRoot,
                        "Local Outlook Mail",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = launcherPath,
                    WorkingDirectory = appRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                startInfo.EnvironmentVariables["LOCAL_OUTLOOK_DATA_DIR"] = InstallRoot;

                using (var process = Process.Start(startInfo))
                {
                    if (process == null)
                    {
                        throw new InvalidOperationException("Unable to start the local application.");
                    }

                    process.WaitForExit();
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    error.Message,
                    "Local Outlook Mail",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
