# Mobile API Reversing

When the web is heavily protected, the same data often ships through the mobile app with weaker bot mitigation. No browser fingerprinting, just a clean JSON endpoint.

## When this is worth it

- The web is behind a strong vendor (Kasada, F5 Shape, custom VM) and you can't find an undocumented XHR.
- The data only exists in the mobile app.
- The app uses simple bearer-token or signed-header auth you can replay.
- You need to reproduce the signing logic offline (see "When the signature lives in native code" below).

## When to stop

- The app uses Play Integrity / Apple App Attest / DeviceCheck / Android Key Attestation. The signing key lives in secure hardware (TEE, StrongBox, Secure Enclave). Rooting does not expose it; nothing the OS can see exposes it. Different problem; this guide doesn't solve it.
- ARM-only apps that don't run on x86 emulators, with no source of a comparable x86 build.
- The signing lives in a bytecode VM you cannot reverse (drive the app as an oracle; the table at the bottom covers when this is worth the latency cost).

## Path A — Intercept and replay (the easy 80%)

1. **Create a rooted Android emulator.** Android Studio → Virtual Device Manager → any phone with the Play Store icon. System image **API 30 (Android 11) is a safe default**; avoid API 28 (rootAVD does not support it).
2. **Root with rootAVD** (`github.com/newbit1/rootAVD`). It handles Magisk, reboot, and confirmation in one command. Verify root by checking for the Magisk app in the drawer.
3. **Install HTTP Toolkit and connect via ADB.** It detects the running AVD and walks you through granting superuser. (macOS: `brew install --cask http-toolkit`.)
4. **Install the target app** (Play Store on the AVD, or drag an APK from apk.support).
5. **Use the app while HTTP Toolkit runs.** Sign in, scroll, paginate, search, open detail views. Filter the capture by the target domain — expect 400+ requests, only ~10 are data endpoints.
6. **Test the request in Postman** before writing code. Confirms the call shape is sufficient, with no extra browser context needed.
7. **Replicate in Python** (or any HTTP client that supports `curl_cffi`-style impersonation):
   ```python
   import curl_cffi.requests as requests
   resp = requests.get(
       "https://api.targetapp.com/v2/listings",
       headers={
           "Authorization": "Bearer <token_from_http_toolkit>",
           "X-App-Version": "4.2.1",
           "User-Agent": "TargetApp/4.2.1 (Android 11; SDK 30)",
           "Accept": "application/json",
       },
       impersonate="chrome120",
   )
   data = resp.json()
   ```
8. **Build token refresh into the scraper.** Mobile tokens expire; check whether the app refreshes on login and mirror that cadence.

### When interception is blocked (SSL pinning)

If the app refuses to route through HTTP Toolkit, it almost certainly pins certificates. Three options, in order of intrusiveness:

- **`objection`** — runtime hook to disable pinning on most apps.
- **Frida script** — hook `SSL_read` / `SSL_write` directly when the app uses native pinning libraries.
- **Burp Suite + Xposed + TrustMeAlready** — a more permanent bypass, requires an Xposed-capable AVD.

### When the app crashes on the rooted emulator

Some apps detect root at startup and refuse to run. Three responses, in order of cost:

- **Magisk DenyList** for that package — hides root from the specific app without unrooting.
- **Older app version** from apk.support (newer versions detect, older don't).
- **Hardened target**. If the app is hardened to the point it enumerates root and integrity signals, the mobile path may be infeasible without dedicated infrastructure. Move to Path B or to a managed API.

## Path B — When the signature lives in native code (`.so`)

Replaying a captured call gets you a 4xx on hardened apps because every request carries anti-fraud headers built by `native` code in a `.so` library. The signing method's name is in JADX; its body is on the far side in compiled ARM.

The decision that shapes everything: **can you rebuild the signer, or do you have to borrow it?**

- **Readable crypto (e.g. HMAC-SHA256 over a known string).** Reverse it in Ghidra, reimplement in Python, sign offline. Fast, no app in the loop, scales. This is the cleanest path and the one to prefer.
- **Bytecode VM you cannot practically rewrite.** Keep the app running and drive its own signer as an oracle your scraper calls. This always works. It's slow.
- **Do not drive the app's UI as your primary signer.** Public natural-language Android-agent rates are 3–5 s/step (fast model) to 15–40 s/step (strong model). A 100-step run is 25–67 minutes on a single device. An offline signer mints the same header in milliseconds. Driving the UI is for the case you genuinely cannot rebuild the signer.

### The native-reversing toolchain

| Tool | Job | Notes |
|---|---|---|
| `androguard` | Fast static recon. Lists the `.so` libraries an app ships, finds which classes declare `native` methods. | Structure, not source. |
| JADX | Decompiles Dalvik back to Java. | How you read the managed side and find the class/method that crosses into native. Stops at the `native` keyword. |
| Ghidra (headless) | Disassembles a `.so`, decompiles to pseudo-C. The only tool that reads native code. | Run headless so the workflow scripts and repeats exactly. |
| Frida | Inject JS into a running process; hook and call functions live. | Use to **confirm** your static reading against what the app actually does. The dynamic check is the one that catches misread assembly. |

> Open the library first, then decide. The vendor's published completion rates are advertising until someone who does not own the agent reproduces them.

## Quick reference: when to use which path

| Situation | Path | Expected effort |
|---|---|---|
| App uses bearer token, no pinning | A — intercept and replay | 1–2 hours |
| App pins certificates, otherwise basic | A + Frida/TrustMeAlready | 1 day |
| App signs requests with `native` HMAC | B — reverse, reimplement in Python | 1–3 days |
| App signs with a bytecode VM you can't reverse | B oracle path (drive the app) | ongoing cost; consider managed API |
| App uses Play Integrity / App Attest | No path without dedicated hardware | consider managed API |
