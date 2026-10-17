# Deploying on the Raspberry Pi

Requirements: a Raspberry Pi 3, 4 or 5 running **64-bit** Raspberry Pi OS (Node 24 has no 32-bit ARM build), with a fixed IP address on your network. Set the fixed IP as a DHCP reservation in your router.

## 1. Install Node.js 24 and Caddy

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git caddy
node -v   # v24.x
```

## 2. Get the code and start the app

```bash
cd ~
git clone <your-repo-url> HomeDashboard
cd HomeDashboard
bash deploy/install.sh
```

This installs the dependencies, builds the frontend, and registers the `homedashboard` systemd service, which starts at boot. The app listens on `127.0.0.1:3000`, and data is stored in `~/HomeDashboard/data/dashboard.db`.

Check it: `curl localhost:3000/api/health` should return `{"ok":true}`. Logs: `journalctl -u homedashboard -f`.

## 3. HTTPS with Caddy

The phone only enables offline mode (Service Worker) over HTTPS, so Caddy puts HTTPS in front of the app using its own local certificate authority.

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # put in your Pi's IP
sudo systemctl reload caddy
```

## 4. Trust the certificate on each device (one-time)

Copy Caddy's root certificate somewhere you can download it:

```bash
sudo cp /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt ~/caddy-root.crt
```

Get it onto your devices: from your PC run `scp pi@192.168.178.50:caddy-root.crt .` and then email or USB it to the phone.

| Device | Steps |
|---|---|
| **Android** | Settings → Security → More security settings → Encryption & credentials → Install a certificate → **CA certificate** → pick `caddy-root.crt`. (Wording varies by manufacturer; search settings for "CA certificate".) |
| **iPhone / iPad** | Open the file (AirDrop/Mail) → Settings → *Profile Downloaded* → Install. Then **Settings → General → About → Certificate Trust Settings → enable** the Caddy root. |
| **Windows** | Double-click `caddy-root.crt` → Install Certificate → Local Machine → "Trusted Root Certification Authorities". Restart the browser. |
| **macOS** | Open in Keychain Access → System keychain → set the certificate to "Always Trust". |

Open `https://192.168.178.50` (your IP). There should be no certificate warning.

## 5. Install as an app on your phone

- **Android (Chrome):** menu ⋮ → *Add to Home screen / Install app*.
- **iPhone (Safari):** Share → *Add to Home Screen*.

Open the app once while you're at home so it caches itself. After that it opens and works offline. Changes you make away from home are kept on the phone and sync when you're back on home WiFi, either automatically or when you tap the sync button.

## Pi status widget

CPU temperature comes from `/sys/class/thermal`. The under-voltage and throttling flags come from `vcgencmd`, which ships with Raspberry Pi OS. The service user must be in the `video` group, which the default user already is. Check with `vcgencmd get_throttled`.

## Updating

Edit on your PC, commit and push. Then on the Pi:

```bash
cd ~/HomeDashboard && bash deploy/update.sh
```

Open devices pick up the new version on their next load.

## Backups

```bash
bash deploy/backup.sh                     # → ~/homedashboard-backups/dashboard-YYYY-MM-DD.db
crontab -e                                # daily at 03:00:
# 0 3 * * * bash /home/pi/HomeDashboard/deploy/backup.sh
```

To restore: `sudo systemctl stop homedashboard`, copy a backup over `data/dashboard.db` and delete `data/dashboard.db-wal` and `data/dashboard.db-shm` if they exist, then start the service again. Devices that already have data simply re-sync with the restored server.
