# DNS migration: WHC → Cloudflare

Migrating `holmgraphics.ca` DNS authority from Web Hosting Canada to
Cloudflare, so we can put the `print.holmgraphics.ca` bridge behind
Cloudflare Tunnel (and later edit M365 email records more easily, and
proxy the client-facing site through Cloudflare's edge).

## Infrastructure snapshot at time of migration

| What | Where |
| --- | --- |
| Domain registrar | Web Hosting Canada (whc.ca) |
| Authoritative DNS (today) | WHC's shared nameservers (discover with `Resolve-DnsName -Type NS holmgraphics.ca -Server 1.1.1.1` — typically `ns1.web-hosting-canada.com` / `ns2.web-hosting-canada.com` or similar). The `ns.holmgraphics.ca` glue record points at `173.209.32.227` (the cPanel host) but that host does **not** answer public port-53 queries — querying it directly will time out. Always query via the discovered WHC NS hostnames or via a public resolver (1.1.1.1, 8.8.8.8). |
| Client-facing website (apex) | WHC cPanel hosting, `/public_html`, IP `173.209.32.227` |
| Shop | **Cloudflare Pages** (`holmgraphics-shop.pages.dev`) via CNAME — already on Cloudflare edge |
| Business email | Microsoft 365 (`holmgraphics-ca.mail.protection.outlook.com`) — planned to migrate off in a future project |
| Print bridge | `C:\tools\holmgraphics-shop\print-bridge\` on Backoffice0 (RIP, 10.10.1.30), running as Scheduled Task at logon |

## Strategy

1. **Move DNS to Cloudflare first**, email stays on M365 untouched.
2. **Every record that matters gets recreated in Cloudflare, grey-cloud
   (DNS-only) initially**, before we change nameservers.
3. **Flip nameservers at WHC** only after Cloudflare's proposed record set
   has been manually diffed against the cPanel Zone Editor export below.
4. Verify the world still works: apex site, `shop`, M365 mail in/out.
5. Turn on **orange-cloud proxy** for the apex + `www` + `shop` only after
   grey-cloud verification passes.
6. **Then** create the `print.holmgraphics.ca` Cloudflare Tunnel hostname.
7. Later cleanup: add DMARC, add M365 DKIM selectors, purge stale DCV CNAMEs.
8. Future project: migrate email off M365 — at that point DNS edits happen
   in Cloudflare, which is a much better place to do it than WHC.

---

## Record mapping: WHC cPanel → Cloudflare

Legend for **Proxy**:
- `DNS-only` (grey cloud) = Cloudflare resolves DNS but doesn't proxy traffic.
- `Proxied` (orange cloud) = traffic goes through Cloudflare's edge (TLS, WAF, cache).
- `n/a` = record types that don't proxy (MX, TXT).

### A records — cPanel infrastructure (all on `173.209.32.227`)

| Name | Value | Proxy | Notes |
| --- | --- | --- | --- |
| `holmgraphics.ca` (apex) | `173.209.32.227` | **DNS-only at first**, then Proxied | Apex website. Verify grey-cloud works before orange-clouding. |
| `ns.holmgraphics.ca` | `173.209.32.227` | DNS-only | WHC glue record; can drop once we're fully off WHC DNS, but harmless to keep. |
| `ftp` | `173.209.32.227` | DNS-only | cPanel FTP — must be grey-cloud (non-HTTP). |
| `cpanel` | `173.209.32.227` | DNS-only | cPanel login on port 2083. Cloudflare's proxy doesn't route 2083. |
| `webmail` | `173.209.32.227` | DNS-only | Same as cpanel. |
| `whm` | `173.209.32.227` | DNS-only | Same. |
| `webdisk` | `173.209.32.227` | DNS-only | Same. |
| `cpcalendars` | `173.209.32.227` | DNS-only | cPanel calendar/CalDAV. |
| `cpcontacts` | `173.209.32.227` | DNS-only | cPanel contacts/CardDAV. |
| `whm.shop` | `173.209.32.227` | DNS-only | Same reasoning. |
| `cpanel.shop` | `173.209.32.227` | DNS-only | |
| `webdisk.shop` | `173.209.32.227` | DNS-only | |
| `cpcalendars.shop` | `173.209.32.227` | DNS-only | |
| `webmail.shop` | `173.209.32.227` | DNS-only | |
| `cpcontacts.shop` | `173.209.32.227` | DNS-only | |

### CNAME records

| Name | Target | Proxy | Notes |
| --- | --- | --- | --- |
| `www` | `holmgraphics.ca` | **DNS-only at first**, then Proxied | Redirect to apex. |
| `mail` | `holmgraphics.ca` | DNS-only | cPanel webmail alias; don't proxy. |
| `autodiscover` | `autodiscover.outlook.com` | **DNS-only (required)** | M365 Outlook autoconfig. **Cannot be proxied** — Outlook clients need direct resolution. |
| `shop` | `holmgraphics-shop.pages.dev` | **Proxied from day one** | Already on Cloudflare Pages. Orange-cloud gives free TLS + Cloudflare CDN. |

### MX records

| Name | Value | Priority | Notes |
| --- | --- | --- | --- |
| `holmgraphics.ca` | `holmgraphics-ca.mail.protection.outlook.com` | `0` | M365 mail. Don't change during this migration. |

### TXT records

| Name | Value | Notes |
| --- | --- | --- |
| `holmgraphics.ca` | `v=spf1 ip4:173.209.32.226 include:spf.web-dns1.com include:spf.protection.outlook.com -all` | SPF. Allows M365 + WHC's mail relay + a specific WHC outbound IP. |
| `default._domainkey.holmgraphics.ca` | `v=DKIM1; k=rsa; p=MIIBIj…QAB;` (long — copy byte-exact from WHC) | cPanel AutoSSL DKIM for mail originated from WHC (form submissions, etc.). |
| `default._domainkey.shop.holmgraphics.ca` | `v=DKIM1; k=rsa; p=MIIBIj…QAB;` (different key from the above) | Same, for the shop subdomain's cPanel-originated mail. |
| `_cpanel-dcv-test-record.holmgraphics.ca` | `_cpanel-dcv-test-record=n0TMA…fmWG` | cPanel domain control validation. |
| `_acme-challenge.holmgraphics.ca` | `DJTnmlEB…j2g` | Let's Encrypt validation (cPanel AutoSSL issues apex cert). |
| `_acme-challenge.shop.holmgraphics.ca` | `1P4rTx2…6zQ` | Same, for `shop`. |
| `_acme-challenge.www.shop.holmgraphics.ca` | `eniwfPs8…l5sg` | Same, for `www.shop`. |

> **Critical detail for the two DKIM TXT records**: the `p=` public key is a
> very long base64 string. When you copy it into Cloudflare, copy it
> byte-for-byte from WHC's Zone Editor — a single wrong character and DKIM
> signing fails silently (M365 still delivers, but SPF alignment breaks
> and your receivers may downgrade reputation). Recommend copy-paste,
> then diff visually at start + end.

### Comodo / Sectigo DCV CNAMEs (probably stale)

There are 15 CNAME records of the form
`_<random-hex>.{www,mail,autodiscover}.holmgraphics.ca` pointing to
various `*.comodoca.com` hosts. These are **Domain Control Validation**
records left over from past Sectigo-issued SSL certs. Most are likely
stale (expired certs).

**Migration decision**: carry them over as-is. They're harmless. After
migration is verified, audit them — keep any that are still active
(check cert expiry dates on WHC), drop the rest.

Full list:
- `_ab34f47c1c345a9152ec76e045e58780.{autodiscover,www,mail}` → `caa50f…comodoca.com`
- `_2db4d6fe5cea5c21fb6ca4c78e105d5f.{www,autodiscover,mail}` → `fe9c85…comodoca.com`
- `_71042f8222762896db453cceb0cb55df.{autodiscover,www,mail}` → `860a5e…comodoca.com`
- `_5a0a0e0c812f81986b856020e5e54d44.{www,autodiscover,mail}` → `6f113d…comodoca.com`
- `_3ea500b3512d401f4e8e004a27443a30.{mail,www,autodiscover}` → `652139…comodoca.com`

### NS records (handled by Cloudflare)

Don't manually migrate NS records. Cloudflare will tell you the two new
nameservers to set at WHC's registrar panel — something like
`curt.ns.cloudflare.com` + `luna.ns.cloudflare.com` (the specific names
are assigned per zone). After the NS flip, Cloudflare's own infrastructure
responds to queries for your zone.

---

## Gaps / known issues in the current zone

Noting these for post-migration cleanup — don't fix during the migration,
only after it's verified:

1. **No DMARC record.** Nothing at `_dmarc.holmgraphics.ca`. This means
   receivers have no policy telling them what to do with SPF/DKIM
   failures, which hurts deliverability over time. After migration, add:
   ```
   _dmarc   TXT   "v=DMARC1; p=none; rua=mailto:postmaster@holmgraphics.ca; fo=1"
   ```
   Start with `p=none` (report-only). Tighten to `p=quarantine` then
   `p=reject` after a few weeks of clean reports.

2. **No M365 DKIM selectors.** `selector1._domainkey` and
   `selector2._domainkey` CNAMEs are missing. M365 is only using default
   signing, which weakens its authentication. Enable in M365 admin →
   Security → DKIM → holmgraphics.ca. M365 will give you two CNAME target
   values; add them as CNAMEs in Cloudflare (grey-cloud / DNS-only).

3. **SPF is slightly over-broad.** `ip4:173.209.32.226` is in the SPF even
   though the apex A points to `.227`. `.226` was the SFTP host — if no
   mail actually originates from there, drop the `ip4:` term.

4. **15 stale Comodo DCV CNAMEs.** Audit after migration, drop any whose
   cert is no longer active.

---

## Migration runbook

### Phase 0 — Pre-flight
- [ ] Confirm this doc matches the live zone (re-open cPanel Zone Editor, diff visually)
- [ ] Discover the actual authoritative nameservers (so verification scripts query the right hosts, not the cPanel web IP which doesn't serve DNS to the public):
  ```powershell
  Resolve-DnsName -Type NS holmgraphics.ca -Server 1.1.1.1
  ```
  Record the hostnames here for future runs of the TTL-check script:
  - `ns?.web-hosting-canada.com` (fill in after first run)
  - `ns?.web-hosting-canada.com`
- [ ] Note current TTLs — most are 14400 (4h). Lower them on WHC to 300 (5 min) **24h before** the NS flip, so rollback is fast if needed. Records to lower (10 total — every record whose value will end up in Cloudflare):
  - `holmgraphics.ca` A
  - `www.holmgraphics.ca` CNAME
  - `shop.holmgraphics.ca` CNAME
  - `mail.holmgraphics.ca` CNAME
  - `autodiscover.holmgraphics.ca` CNAME
  - `holmgraphics.ca` MX
  - `holmgraphics.ca` TXT (SPF)
  - `default._domainkey.holmgraphics.ca` TXT (DKIM apex)
  - `default._domainkey.shop.holmgraphics.ca` TXT (DKIM shop)
  - `_cpanel-dcv-test-record.holmgraphics.ca` TXT (cPanel DCV — easy to overlook)
- [ ] Verify all 10 are at TTL 300 from public resolvers (script in `docs/scripts/check-ttls.ps1`, see below).
- [ ] Confirm access to: WHC client area, cPanel, a working mail client for holmgraphics.ca (to test mail after flip), and the print bridge RIP.

### Phase 1 — Cloudflare zone setup
- [ ] Sign in to Cloudflare dashboard; Add Site → `holmgraphics.ca` → Free plan
- [ ] Let the scanner propose records
- [ ] Diff Cloudflare's proposal against the mapping table above
- [ ] Add any records Cloudflare missed (likely candidates: the `_acme-challenge`s, `_cpanel-dcv-test-record`, maybe the Comodo DCVs)
- [ ] Set **every** record to grey-cloud (DNS-only) for now — including the apex and `www` that we'll later proxy
- [ ] Exception: `shop.holmgraphics.ca` CNAME → `holmgraphics-shop.pages.dev` — leave this orange-cloud since it's already Cloudflare Pages
- [ ] Verify MX priority is `0` (match the WHC record exactly)
- [ ] Verify the two DKIM TXTs have the correct `p=` values byte-for-byte
- [ ] **Do NOT click "Continue to activation" in Cloudflare yet** — we want the zone ready but not live

### Phase 2 — Nameserver swap at WHC
- [ ] In Cloudflare, copy the two assigned nameservers (shown on the zone's overview page)
- [ ] In WHC client area → Domains → `holmgraphics.ca` → Nameservers
- [ ] Replace WHC's nameservers with Cloudflare's two
- [ ] Save
- [ ] In Cloudflare, click "Check nameservers" / "Continue" — it may take 15 min to 24 h to propagate (usually < 1 h in practice)
- [ ] When Cloudflare shows "Active", move to Phase 3

### Phase 3 — Post-flip verification (do within the first hour of "Active")

Open a fresh shell on any machine and check:

```powershell
# From Windows:
Resolve-DnsName holmgraphics.ca       -Server 1.1.1.1
Resolve-DnsName www.holmgraphics.ca   -Server 1.1.1.1
Resolve-DnsName shop.holmgraphics.ca  -Server 1.1.1.1
Resolve-DnsName holmgraphics.ca -Type MX  -Server 1.1.1.1
Resolve-DnsName holmgraphics.ca -Type TXT -Server 1.1.1.1
Resolve-DnsName autodiscover.holmgraphics.ca -Server 1.1.1.1
```

Expected:
- Apex and `www` resolve to `173.209.32.227` (still WHC — because grey cloud).
- `shop` resolves to Cloudflare edge IP (100.x.x.x range, or similar).
- MX returns `holmgraphics-ca.mail.protection.outlook.com` at priority 0.
- SPF TXT matches.
- `autodiscover` CNAME to `autodiscover.outlook.com`.

Manual checks:
- [ ] Load `https://holmgraphics.ca` in a fresh browser (hard refresh, incognito). Should serve the WHC-hosted site exactly as before. SSL should still work (same cert as before, since traffic isn't hitting Cloudflare's edge yet).
- [ ] Load `https://shop.holmgraphics.ca`. Should serve from Cloudflare Pages.
- [ ] Send a test email **to** a holmgraphics.ca address from Gmail. Should arrive in M365 within a minute.
- [ ] Send a test email **from** a holmgraphics.ca address to Gmail. Should arrive with SPF pass (check Gmail's "Show original").
- [ ] Outlook desktop: close and re-open; it should reconnect cleanly via Autodiscover.

If anything fails, rollback is fast: change nameservers back at WHC. That's why we lowered TTL to 300 in Phase 0.

### Phase 4 — Enable proxy (orange cloud)
Once Phase 3 is green and has been stable for a few hours:

- [ ] In Cloudflare DNS, flip the apex `A` record to orange-cloud (Proxied)
- [ ] Flip `www` CNAME to orange-cloud
- [ ] Wait ~5 min, re-test the apex site in a fresh incognito window
- [ ] If the site breaks (mixed-content errors, redirect loops, cert issues), flip back to grey-cloud and investigate the WHC end — common fixes: enable "Flexible SSL" in Cloudflare, or configure "Always Use HTTPS" rules

### Phase 5 — Create the print bridge tunnel
Only after Phases 1–4 are done and stable.

- [ ] Install `cloudflared` on Backoffice0 (RIP)
- [ ] `cloudflared tunnel login` → browser auth → pick `holmgraphics.ca`
- [ ] `cloudflared tunnel create holmgraphics-print`
- [ ] `cloudflared tunnel route dns holmgraphics-print print.holmgraphics.ca`
- [ ] Create `C:\Users\DarrenJHolm\.cloudflared\config.yml` with ingress rule pointing to `http://127.0.0.1:41960`
- [ ] `cloudflared service install` (runs as Windows service; tunnel is session-agnostic)
- [ ] Test: `curl https://print.holmgraphics.ca/health` from any machine on the internet
- [ ] Update web app env: `VITE_PRINT_BRIDGE_URL=https://print.holmgraphics.ca`

### Phase 6 — Post-migration cleanup (separate tasks, no time pressure)
- [ ] Add DMARC at `_dmarc` (start with `p=none`)
- [ ] Enable M365 DKIM in admin center, add `selector1` + `selector2` CNAMEs
- [ ] Audit Comodo DCV CNAMEs, drop stale ones
- [ ] Consider trimming SPF `ip4:173.209.32.226` if nothing sends from that IP
- [ ] Raise TTLs back to 3600 or 14400 for records that don't change often

---

## Appendix: why `shop` can (and should) be proxied immediately

`shop.holmgraphics.ca` currently resolves to `holmgraphics-shop.pages.dev`.
That's a Cloudflare Pages site — meaning the traffic *already* terminates
at Cloudflare's edge regardless of what nameserver you use. Orange-clouding
that CNAME once the zone is on Cloudflare just means the edge serves
`shop.holmgraphics.ca` directly as the canonical hostname, without the
extra hop of resolving the `pages.dev` CNAME. It's strictly faster and
gives you Cloudflare Page Rules / Workers on that hostname.

## Appendix: why the cPanel subdomains stay grey-cloud forever

cPanel services live on non-HTTP ports:
- `cpanel` → 2083 (HTTPS)
- `whm` → 2087
- `webmail` → 2096
- Webdisk / CalDAV / CardDAV → other non-standard ports

Cloudflare's proxy only accepts traffic on HTTP/HTTPS standard ports.
Orange-clouding these records would break the cPanel UIs. Leave them
grey-cloud; clients connect directly to WHC's IP on the cPanel port.
