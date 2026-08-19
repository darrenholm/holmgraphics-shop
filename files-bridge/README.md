# Holm Graphics Files Bridge

A small HTTP service that exposes the `ClientFilesA-K` and `ClientFilesL-Z` folders (client artwork storage) to the Holm Graphics Shop web app — reached either through a mapped `L:` drive or straight over UNC, depending on the machine (see [Where the bridge runs](#where-the-bridge-runs)).

**Runs on DesignCentre4 (LAN IP `10.10.1.24`) — NOT on the RIP.** The print-bridge stays on Backoffice0 (10.10.1.30) because that's where the DYMO is plugged in, but the files-bridge has to live on a machine that can actually read the L: share. Backoffice0's modern Windows 10 22H2 can't reliably negotiate SMB with the legacy Buffalo LS220 NAS (firmware caps at 1.86, SMB1-only dialect); DesignCentre4 maps L: successfully, so the files-bridge lives there. Once the NAS is replaced with a modern SMB3-capable unit, both bridges can be consolidated onto the RIP.

The web app uses this to:

- Show the files inside a job's `Job<number>` folder as clickable links on the job detail page.
- Auto-create a matching `Job<number>` subfolder under the client's folder when a new job is added to the system.
- Let staff download / open artwork directly from the app without browsing to the L: drive manually.

The bridge itself is dumb — it authenticates every request with a single shared bearer token and restricts file access to a configured allow-list of root folders (`FILES_ROOTS`). There is no per-user access control at this layer; the Railway backend will be responsible for that in Phase 2 (per-client password-protected access).

## Where the bridge runs

**Read this before updating anything.** The install described under *Install* below is the drive-letter layout. DesignCentre4 does **not** use it. What's actually running there:

| | Documented layout | DesignCentre4, as built |
|---|---|---|
| Folder | `C:\tools\holmgraphics-shop\files-bridge` | `C:\holmgraphics\files-bridge` |
| Roots | `L:\ClientFilesA-K`, `L:\ClientFilesL-Z` | `\\10.10.1.226\share\ClientFilesA-K`, `…L-Z` |
| Launch | task runs `node server.js` | task runs `start-bridge.ps1`, which does `net use` against the NAS **then** starts node |

The UNC form sidesteps the per-user mapped drive entirely, which is the better arrangement — but it means a copy of the repo sitting at `C:\tools\holmgraphics-shop\` is **not** the running bridge. Updating that clone changes nothing. Find the live install before touching it:

```powershell
# the folder the running node process was launched from
$node = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
Get-CimInstance Win32_Process -Filter "ProcessId=$($node.ParentProcessId)" |
  Select-Object CommandLine | Format-List
```

`install-task.ps1` handles both layouts: if `start-bridge.ps1` sits next to `server.js` it registers the task to run *that*, so the credential step isn't skipped. Its `-BridgeDir` defaults to the folder the script itself lives in, so when you run a copy out of a clone, pass the real folder:

```powershell
C:\tools\holmgraphics-shop\files-bridge\install-task.ps1 -BridgeDir 'C:\holmgraphics\files-bridge' -StartNow
```

### Updating the running bridge

```powershell
# from the live folder — git pull if it's a clone, otherwise copy server.js in
Copy-Item C:\holmgraphics\files-bridge\server.js C:\holmgraphics\files-bridge\server.js.bak -Force
Copy-Item <updated-repo>\files-bridge\server.js C:\holmgraphics\files-bridge\server.js -Force
Select-String -Path C:\holmgraphics\files-bridge\server.js -Pattern "job-folder-rename"   # expect a match
Stop-ScheduledTask -TaskName 'Holm Files Bridge'
C:\holmgraphics\files-bridge\install-task.ps1 -StartNow
```

The `/health` probe at the end reports the version and feature list — that's how you tell the update actually took.

> **Credentials:** `start-bridge.ps1` currently carries the NAS account's password in plaintext. Worth moving to `cmdkey /add` (stored per-user, so the interactive task still picks it up) and rotating the account. Not done yet.

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
| `GET`  | `/health` | Liveness, version, `features[]`, and which roots are mounted. Unauthenticated. |
| `GET`  | `/clients/:name/tree` | Listing of the client's root folder. |
| `GET`  | `/clients/:name/jobs/:jobNo/tree` | Listing of a job's subfolder. |
| `POST` | `/clients/:name/jobs/:jobNo/ensure` | Create the client folder and job subfolder if they don't exist. Optional body `{ desc }` names a **new** folder `Job<jobNo> - <desc>`. Idempotent. |
| `GET`  | `/folders` | List every top-level folder in both buckets. Powers the manual-match picker in the web app. |
| `POST` | `/folders` | Create a new folder. Body: `{ name }`. Bucket is picked automatically from the first letter. |
| `GET`  | `/file?path=<abs>` | Stream a file the client got from a tree listing. Path must resolve inside one of the configured `FILES_ROOTS`. |
| `POST` | `/clients/:name/jobs/:jobNo/upload` | Upload a file into the job folder. Query: `subfolder`, `as`, `desc` (names the folder if this upload creates it). |
| `POST` | `/clients/:name/jobs/:jobNo/rename` | Body `{ desc }`. Renames an existing job folder to `Job<jobNo> - <desc>`. 409 if that name is taken; never moves outside the client folder. |

### Job folder names

New job folders are created as `Job<num> - <description>` — e.g. `Job2323 - Truck Letters` — so the folder says what the job is without opening the shop. The description comes from the job's description field and is scrubbed to characters Windows accepts (60 max).

Folder creation never renames anything on its own — `/ensure` and `/upload` only name a folder they are creating. `resolveJobFolder` matches on the job number prefix, so a bare `Job2323` and a `Job2323 - Truck Letters` both keep working side by side.

Old bare folders are fixed **one job at a time**, on purpose, from the job's Files card in the shop (`POST /rename` under the hood). What that costs: the API stores absolute paths in `designs.artwork_path` (DTF-store artwork), and those rows keep pointing at the pre-rename path, so the "open artwork" link on such a job goes dead until the row is repaired. The file itself is fine — only the stored path is stale. The shop writes a job note recording `old → new` on every rename so the move is traceable, and a repair is a one-liner:

```sql
UPDATE designs SET artwork_path = REPLACE(artwork_path, '\Job2323\', '\Job2323 - Truck Letters\')
WHERE artwork_path LIKE '%\Job2323\%';
```

In practice the overlap is small: `artwork_path` only exists for DTF-store designs, which are recent, and recent jobs already get named folders. A bulk sweep over every old folder is deliberately **not** built — it would invalidate those paths en masse with no per-job trail.

If a client folder somehow holds two folders for one job (someone made `Job2323 - Barn Letters` by hand next to `Job2323`), `/tree` returns `jobFolderMatches` listing them and the shop warns which one it is using. Merge them in Explorer — the bridge won't pick for you.

Folder descriptions arrived in bridge **1.3.0**; renaming in **1.4.0**. `/health` reports `"features": ["job-folder-desc", "job-folder-rename"]`. When the shop's Files card says the bridge is out of date, it's the **running** install that needs updating — see [Where the bridge runs](#where-the-bridge-runs). An older copy silently drops the description and creates bare `Job####` folders no matter what the web app sends, and hides the rename control entirely.

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
