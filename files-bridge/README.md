# Holm Graphics Files Bridge

A small HTTP service that exposes the `L:\ClientFilesA-K` and `L:\ClientFilesL-Z` folders (client artwork storage) to the Holm Graphics Shop web app.

**Runs on DesignCentre4 (LAN IP `10.10.1.24`) — NOT on the RIP.** The print-bridge stays on Backoffice0 (10.10.1.30) because that's where the DYMO is plugged in, but the files-bridge has to live on a machine that can actually read the L: share. Backoffice0's modern Windows 10 22H2 can't reliably negotiate SMB with the legacy Buffalo LS220 NAS (firmware caps at 1.86, SMB1-only dialect); DesignCentre4 maps L: successfully, so the files-bridge lives there. Once the NAS is replaced with a modern SMB3-capable unit, both bridges can be consolidated onto the RIP.

The web app uses this to:

- Show the files inside a job's `Job<number>` folder as clickable links on the job detail page.
- Auto-create a matching `Job<number>` subfolder under the client's folder when a new job is added to the system.
- Let staff download / open artwork directly from the app without browsing to the L: drive manually.

The bridge itself is dumb — it authenticates every request with a single shared bearer token and restricts file access to a configured allow-list of root folders (`FILES_ROOTS`). There is no per-user access control at this layer; the Railway backend will be responsible for that in Phase 2 (per-client password-protected access).

## Install

All steps run on **DesignCentre4** (the machine with L: already mapped and working).

1. **Copy the folder into place.** Same layout as the print-bridge:

    ```
    C:\tools\holmgraphics-shop\files-bridge\
        server.js
        package.json
        .env.example
        install-task.ps1
    ```

2. **Install dependencies.** Open PowerShell in that folder:

    ```powershell
    cd C:\tools\holmgraphics-shop\files-bridge
    npm install
    ```

3. **Create the `.env`.** Copy the example and set a real API key. The same key will need to go in the web app's `.env` as `VITE_FILES_BRIDGE_KEY`.

    ```powershell
    Copy-Item .env.example .env
    # then edit .env:
    #   API_KEY=<paste output of: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
    notepad .env
    ```

4. **Verify L: is reachable for the user that will run the task.** The scheduled task runs inside that user's interactive session, which is the only place Windows will honor a per-user mapped network drive. From a PowerShell window opened **as the user the task will run as**:

    ```powershell
    Test-Path 'L:\ClientFilesA-K'   # should return True
    Test-Path 'L:\ClientFilesL-Z'   # should return True
    ```

   If either returns `False`, remap the drive (Windows Explorer → This PC → Map network drive…) with **Reconnect at sign-in** checked before continuing.

5. **Register the scheduled task.** From an elevated PowerShell:

    ```powershell
    cd C:\tools\holmgraphics-shop\files-bridge
    .\install-task.ps1 -StartNow
    ```

   `-StartNow` registers the task, starts it, and probes `http://127.0.0.1:41961/health`. Expect a 200 with `{"ok":true,"service":"holmgraphics-files-bridge",...}` and each root listed as `exists: true`.

6. **Open the firewall** (once per machine) so other devices on the shop LAN can reach the bridge:

    ```powershell
    New-NetFirewallRule -DisplayName 'Holm Files Bridge' -Direction Inbound -Protocol TCP -LocalPort 41961 -Action Allow -Profile Private
    ```

7. **Smoke-test from another machine on the LAN:**

    ```powershell
    Invoke-WebRequest http://10.10.1.24:41961/health | Select-Object -Expand Content
    ```

## Configure the web app

In the web app repo's `.env` (and in whatever CI / Pages build env ships production), set:

```
VITE_FILES_BRIDGE_URL=http://10.10.1.24:41961
VITE_FILES_BRIDGE_KEY=<same value as files-bridge/.env API_KEY>
```

After changing `.env`, rebuild:

```
npm run build
npx cap sync android       # if you want the Android APK picked up
```

## Endpoints

All authenticated endpoints require `Authorization: Bearer <API_KEY>`. Paths are case-insensitive and tolerant of minor formatting differences (`HuronBayCoop` / `Huron Bay Coop`, `Job3518` / `Job 3518` / `3518`).

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness + which roots are mounted. Unauthenticated. |
| `GET`  | `/clients/:name/tree` | Listing of the client's root folder. |
| `GET`  | `/clients/:name/jobs/:jobNo/tree` | Listing of a job's subfolder. |
| `POST` | `/clients/:name/jobs/:jobNo/ensure` | Create the client folder and `Job<jobNo>` subfolder if they don't exist. Idempotent. |
| `GET`  | `/file?path=<abs>` | Stream a file the client got from a tree listing. Path must resolve inside one of the configured `FILES_ROOTS`. |

## Debugging

- **Log file:** `C:\tools\holmgraphics-shop\files-bridge\bridge.log` — tail with `Get-Content bridge.log -Tail 40 -Wait`.
- **Task state:** `Get-ScheduledTask -TaskName 'Holm Files Bridge' | Format-List`.
- **Restart:** `Stop-ScheduledTask -TaskName 'Holm Files Bridge'; Start-ScheduledTask -TaskName 'Holm Files Bridge'`.
- **"roots: MISSING" in log:** L: isn't mapped for the task's user. See step 4 above.
- **401 from web app:** `VITE_FILES_BRIDGE_KEY` doesn't match `API_KEY`. Rebuild the app after fixing `.env`.
- **CORS failure in browser console:** add the app's origin to `ALLOWED_ORIGINS` in `.env`, then restart the task.

## Uninstall

```powershell
Unregister-ScheduledTask -TaskName 'Holm Files Bridge' -Confirm:$false
Remove-NetFirewallRule -DisplayName 'Holm Files Bridge'
```

## Roadmap

- **Cloudflare Tunnel → `https://files.holmgraphics.ca`.** Makes the bridge reachable from outside the shop LAN (phone app on LTE, remote laptops). Same tunnel story as print.holmgraphics.ca.
- **Per-client password access.** Railway backend issues short-lived HMAC-signed URLs scoped to one folder; bridge accepts them as a second auth mode alongside the master `API_KEY`.
- **Upload from app.** `POST /file` so staff can drag-drop artwork into a job from the phone without remoting into the RIP.
