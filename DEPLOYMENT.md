# Deployment Cheat Sheet

## Quick Reference

### Deploy to production
```bash
git push origin main
```
GitHub Actions automatically tests, packages, and deploys to your server.

### SSH into server
```bash
ssh deploy@159.65.197.157
```

### View app logs
```bash
ssh deploy@159.65.197.157
pm2 logs teambuilding
```

### Restart app manually
```bash
ssh deploy@159.65.197.157
pm2 restart teambuilding
```

### Stop app
```bash
ssh deploy@159.65.197.157
pm2 stop teambuilding
```

### Start app
```bash
ssh deploy@159.65.197.157
pm2 start /var/www/teambuilding/current/server.js --name teambuilding
```

### Check app status
```bash
ssh deploy@159.65.197.157
pm2 status
```

---

## Initial Setup (One-Time Only)

### 1. Create DigitalOcean droplet
- Image: Ubuntu 24.04 LTS
- Size: $4/month (1GB RAM, 1 vCPU)
- Region: pick one close to users
- Add your SSH key during creation

### 2. One-time server setup
SSH as root and run:
```bash
ssh root@159.65.197.157

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs

# Install pm2 globally
npm install -g pm2

# Create deploy user
useradd -m -s /bin/bash deploy
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh

# Add your SSH key to deploy user
cat > /home/deploy/.ssh/authorized_keys <<'EOF'
[YOUR_PUBLIC_SSH_KEY_HERE]
EOF

chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# Create deploy directory
mkdir -p /var/www/teambuilding
chown deploy:deploy /var/www/teambuilding
```

### 3. Configure pm2 for auto-restart on reboot
```bash
ssh root@159.65.197.157

sudo -u deploy pm2 startup systemd -u deploy --hp /home/deploy
systemctl status pm2-deploy
```

### 4. Add GitHub repository secrets
Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `DEPLOY_HOST` | `159.65.197.157` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | (your private SSH key from `~/.ssh/id_ed25519`) |
| `DEPLOY_PATH` | `/var/www/teambuilding` |
| `PUBLIC_ORIGIN` | `http://159.65.197.157:3000` |

---

## Troubleshooting

### App not running after push
Check the GitHub Actions workflow in the **Actions** tab. If it failed, check the deploy job logs.

### Logs show permission errors
The `deploy` user likely lost permission to pm2. Fix:
```bash
ssh root@159.65.197.157
mkdir -p /home/deploy/.pm2
chown -R deploy:deploy /home/deploy/.pm2
```

### App crashes frequently
```bash
ssh deploy@159.65.197.157
pm2 logs teambuilding --lines 50
```
Check the last 50 lines of logs for error messages.

### App not restarting after server reboot
```bash
ssh deploy@159.65.197.157
pm2 status
```
If `teambuilding` is missing or stopped, restart it manually:
```bash
pm2 start /var/www/teambuilding/current/server.js --name teambuilding
pm2 save
```

### Connection refused on http://159.65.197.157:3000
- Check if the app is running: `pm2 status`
- Check if port 3000 is exposed (droplet firewall)
- Check logs: `pm2 logs teambuilding`

---

## Deployment Architecture

- **Code**: GitHub repo at `Attic-at-Night/TeamBuilding`
- **Server**: DigitalOcean droplet (`159.65.197.157`)
- **Deploy user**: `deploy@159.65.197.157`
- **App directory**: `/var/www/teambuilding/`
- **Releases**: `/var/www/teambuilding/releases/[GIT_SHA]/`
- **Current symlink**: `/var/www/teambuilding/current` → latest release
- **Process manager**: pm2
- **Process name**: `teambuilding`
- **Port**: 3000
- **Auto-restart**: yes (systemd + pm2)

---

## Workflow

1. **Local development**: `npm start` (runs on `http://localhost:3000`)
2. **Commit & push to main**: `git push origin main`
3. **GitHub Actions triggers**:
   - `npm ci` → installs dependencies
   - `npm test` → runs all tests
   - Packages app as `.tar.gz`
   - Deploys to server over SSH
   - Extracts, installs prod deps, restarts pm2
4. **App live**: `http://159.65.197.157:3000`

---

## Useful Commands

### View all pm2 processes
```bash
ssh deploy@159.65.197.157
pm2 list
```

### Delete a process from pm2
```bash
ssh deploy@159.65.197.157
pm2 delete teambuilding
pm2 save
```

### Manually run the app (for debugging)
```bash
ssh deploy@159.65.197.157
cd /var/www/teambuilding/current
set -a && . ./.env && set +a
node server.js
```

### Check server disk space
```bash
ssh deploy@159.65.197.157
df -h
```

### Check server resource usage
```bash
ssh deploy@159.65.197.157
top
# Press 'q' to exit
```

### Clean old releases (optional)
Old releases accumulate in `/var/www/teambuilding/releases/`. You can safely delete old ones:
```bash
ssh deploy@159.65.197.157
ls -la /var/www/teambuilding/releases/ | head -20
# Delete old SHA directories you don't need
rm -rf /var/www/teambuilding/releases/[OLD_SHA]
```
