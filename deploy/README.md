# Deploying on the Raspberry Pi

Requirements: a Raspberry Pi 3, 4 or 5 running **64-bit** Raspberry Pi OS (Node 24 has no 32-bit ARM build), with a fixed IP address on your network. Set the fixed IP as a DHCP reservation in your router.

## 1. Install Node.js 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git
node -v   # v24.x
```

## 2. Get the code and start the app

```bash
cd ~
git clone <repo-url> HomeDashboard
cd HomeDashboard
bash deploy/install.sh
```

This installs the dependencies, builds the frontend, and registers the `homedashboard` systemd service, which starts at boot. The app listens on `127.0.0.1:3000`, and data is stored in `~/HomeDashboard/data/dashboard.db`.

Check it: `curl localhost:3000/api/health` should return `{"ok":true}`. Logs: `journalctl -u homedashboard -f`.

## 3. Choose how your devices reach the dashboard

The dashboard works fully over plain HTTP. **HTTPS is only needed for the extras**: offline mode, installing it as an app, and timer notifications. Browsers allow these only on HTTPS pages.

| | Offline mode & app install | Use away from home | Setup |
|---|---|---|---|
| **A. Tailscale** *(recommended)* | ✅ | ✅ | Tailscale app on every device; real certificate, nothing to install |
| **B. Caddy** | ✅ | ❌ home network only | Install a root certificate once on every device |
| **C. Plain HTTP** | ❌ | ❌ home network only | One setting, done |

You can combine them, e.g. Tailscale for your phone and laptop plus Caddy or HTTP for a wall tablet without Tailscale. All devices share the same data.

> **One address per device.** Browsers keep the offline data per address, so `https://192.168.x.x` and the Tailscale address count as two separate apps. Pick one address per device and stick with it.

### Option A: Tailscale (HTTPS at home and away)

1. Create a free account at [tailscale.com](https://tailscale.com), then on the Pi:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up            # open the printed link and log in
   ```
2. In the [admin console](https://login.tailscale.com/admin):
   - **DNS**: turn on **MagicDNS** and **Enable HTTPS Certificates**.
   - **Machines**: on the Pi, choose **⋯ → Disable key expiry**.
3. Serve the dashboard to your Tailscale devices (this survives reboots):
   ```bash
   sudo tailscale serve --bg http://127.0.0.1:3000
   tailscale serve status       # shows your address, e.g. https://raspberrypi.tail1234.ts.net
   ```
   Don't enable *Funnel*: that would make the dashboard public on the internet.
4. Install the Tailscale app on your phone and PC, log in with the same account, and open the address from step 3.

### Option B: Caddy (HTTPS in the home network)

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # replace the example IP with your Pi's IP
sudo systemctl reload caddy
```

Caddy creates its own certificate authority, which each device must trust once. Copy the root certificate to your home folder:

```bash
sudo cp /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt ~/caddy-root.crt
sudo chown $USER ~/caddy-root.crt
```

To get it onto your devices, the easiest way is to serve it briefly: run `cd ~ && python3 -m http.server 8000` on the Pi, open `http://<pi-ip>:8000/caddy-root.crt` on each device, then stop the server with Ctrl+C.

| Device | Steps |
|---|---|
| **Android** | Settings → Security → More security settings → Encryption & credentials → Install a certificate → **CA certificate** → pick `caddy-root.crt`. (Wording varies by manufacturer; search settings for "CA certificate".) |
| **iPhone / iPad** | Open the file → Settings → *Profile Downloaded* → Install. Then **Settings → General → About → Certificate Trust Settings → enable** the Caddy root. |
| **Windows** | Double-click `caddy-root.crt` → Install Certificate → Local Machine → "Trusted Root Certification Authorities". Restart the browser. |
| **macOS** | Open in Keychain Access → System keychain → set the certificate to "Always Trust". |

Open `https://<pi-ip>`. There should be no certificate warning.

### Option C: Plain HTTP (simplest, no offline mode)

Let the app accept connections from your network instead of only from the Pi itself:

```bash
sudo sed -i 's/HOST=127.0.0.1/HOST=0.0.0.0/' /etc/systemd/system/homedashboard.service
sudo systemctl daemon-reload && sudo systemctl restart homedashboard
```

Open `http://<pi-ip>:3000`. Everything works while the device can reach the Pi. It just can't be opened without a connection, installed as an app, or show timer notifications. Use a browser bookmark or a home-screen shortcut instead.

*Note:* `deploy/install.sh` rewrites the service file, so run the two commands again if you ever re-run the install script.

## 4. Install as an app on your phone (options A and B)

- **Android (Chrome):** menu ⋮ → *Add to Home screen / Install app*.
- **iPhone (Safari):** Share → *Add to Home Screen*.

Open the app once while connected so it caches itself. After that it opens and works offline. Changes made without a connection are kept on the phone and sync once the Pi is reachable again, either automatically or when you tap the sync button.

## Pi status widget

CPU temperature comes from `/sys/class/thermal`. The under-voltage and throttling flags come from `vcgencmd`, which ships with Raspberry Pi OS. The service user must be in the `video` group, which the default user already is. Check with `vcgencmd get_throttled`.

## Updating

On the Pi:

```bash
cd ~/HomeDashboard && bash deploy/update.sh
```

This pulls the latest code, rebuilds and restarts. Your data is kept. Open devices pick up the new version on their next load.

## Backups

```bash
bash deploy/backup.sh                     # → ~/homedashboard-backups/dashboard-YYYY-MM-DD.db
crontab -e                                # daily at 03:00:
# 0 3 * * * bash /home/<user>/HomeDashboard/deploy/backup.sh
```

Backups are stored outside the project folder, so they survive if the folder is deleted. To restore: `sudo systemctl stop homedashboard`, copy a backup over `data/dashboard.db` and delete `data/dashboard.db-wal` and `data/dashboard.db-shm` if they exist, then start the service again. Devices that already have data simply re-sync with the restored server.
