# Why the service might not see DYMO Connect

## The short version
`install-service.js` doesn't pass `logOnAs`, so node-windows installs the
service under **LocalSystem** (a.k.a. `NT AUTHORITY\SYSTEM`). LocalSystem
lives in **Session 0**. DYMO Connect for Desktop is a tray/desktop app that
only runs **inside the logged-in user's session** (Session 1, 2, ...).

Two things follow from that:

1. **If no user is logged in on Backoffice0, DYMO Connect isn't running at all.**
   Its local HTTPS port `41951` simply isn't listening. Section 9 of `diag.ps1`
   will flag this.
2. **If a user _is_ logged in, loopback TCP _does_ cross sessions** — so
   LocalSystem in Session 0 can in fact reach `127.0.0.1:41951` as long as
   DYMO Connect is running somewhere on the machine. Loopback is not
   session-isolated. So the Session 0 story is really about *"is DYMO
   Connect running?"* more than *"can the two sockets see each other?"*

The practical consequence: if you want the bridge to work when nobody is
logged in, you either need DYMO Connect to auto-launch (it won't, without a
logged-in user), or you need the whole stack to run inside a real user
session.

---

## Three remediation paths (pick one)

### Option A — Run the service as your user account (simplest)
Reinstall the service with explicit credentials so it runs as `DesignCentre4\DarrenJHolm`
(or whatever account the RIP uses). This alone **doesn't** put it in your
interactive session, but combined with Option C below it does.

In `install-service.js`, add to the `Service` constructor:

```js
logOnAs: {
  domain:   'BACKOFFICE0',           // or '.' for local
  account:  'DarrenJHolm',
  password: '...'                    // put in a .service.env, don't commit
}
```

Then `npm run uninstall-service` and `npm run install-service`.

Pros: Still a proper Windows service. Respawns on crash.
Cons: Password stored by SCM (encrypted but recoverable by admin). Still
Session 0 by default — only helps if DYMO Connect is also running somewhere.

### Option B — Switch to NSSM (nicer than node-windows)
[NSSM](https://nssm.cc/) wraps node.exe directly, gives you clean log files,
proper stdout/stderr redirection, and easy "Log on as" config via the SCM UI.

```cmd
choco install nssm           REM or download from nssm.cc
nssm install HolmPrintBridge "C:\Program Files\nodejs\node.exe" "C:\tools\holmgraphics-shop\print-bridge\server.js"
nssm set    HolmPrintBridge AppDirectory "C:\tools\holmgraphics-shop\print-bridge"
nssm set    HolmPrintBridge AppStdout    "C:\tools\holmgraphics-shop\print-bridge\out.log"
nssm set    HolmPrintBridge AppStderr    "C:\tools\holmgraphics-shop\print-bridge\err.log"
nssm set    HolmPrintBridge ObjectName   ".\DarrenJHolm" "YOUR_PASSWORD"
nssm start  HolmPrintBridge
```

Pros: Easy to configure, great logs, trivially editable.
Cons: Extra dependency (nssm.exe ~300 KB).

### Option C — Task Scheduler + autologon (what I'd actually recommend)
The bridge only works when DYMO Connect is running, and DYMO Connect only
runs when a user is logged in. So just make the RIP log itself in and keep
the bridge in that same session:

1. Set Backoffice0 to **autologon** as DarrenJHolm on boot
   (`netplwiz`, uncheck "Users must enter a username and password", or use
   Sysinternals Autologon).
2. Uninstall the old node-windows service.
3. Create a Scheduled Task:
   - Trigger: **At log on of DarrenJHolm**
   - Action: `C:\Program Files\nodejs\node.exe  C:\tools\...\server.js`
   - Start in: the print-bridge folder
   - "Run only when user is logged on" ✅
   - "Run with highest privileges" ✅ (lets it bind ports if needed)
4. DYMO Connect is already set to auto-start on login (the default); leave it.

Pros: Everything runs in the same session as DYMO Connect. No account
juggling. Survives reboots because of autologon.
Cons: Anyone with physical access to Backoffice0 walks into a logged-in
desktop. For a print RIP in a back office this is usually fine — just
screen-lock the machine.

---

## Recommendation
Given the RIP is a dedicated back-office print machine and you're already
remoting in via Chrome Remote Desktop (which requires the target to be
signed in anyway), **Option C is the least-fussy**. NSSM (B) is the right
second choice if you want a "proper service" feel. Option A alone doesn't
actually solve the core problem.

Run `diag.ps1` first — the sections it flags will tell you whether you're
fighting Session 0 at all or just a crash-loop from a missing `.env`.
