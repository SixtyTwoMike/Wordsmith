# Deploying Wordsmith to AWS Lightsail

Wordsmith is a static PWA (no backend, no build). This sets up **automatic
deploys**: every push to `claude/iphone-screenwriting-app-moihhx` runs a
GitHub Action that `rsync`s the files to your Lightsail instance, where
**Caddy** serves them over HTTPS (auto Let's Encrypt).

You do the five one-time steps below (they need your AWS account and keys —
I can't do these for you). After that, deploys are hands-off.

---

## 0. Prerequisites
- A Lightsail **instance** (Ubuntu recommended) with a **static IP** attached
  (Lightsail → your instance → Networking → Create static IP).
- One of your domains available for a subdomain, e.g. `wordsmith.example.com`.

## 1. DNS — point a subdomain at the instance
In your DNS provider, add an **A record**:

```
wordsmith.example.com  →  <your instance's static IP>
```

Give it a minute to propagate (`dig +short wordsmith.example.com` should
return the IP).

## 2. Lightsail firewall — open the web ports
Lightsail → your instance → **Networking** → IPv4 Firewall → add rules:
- **HTTP**  TCP **80**
- **HTTPS** TCP **443**

(80 is needed for the Let's Encrypt challenge; 443 serves the app.)

## 3. Create a dedicated deploy SSH key
On your own machine:

```sh
ssh-keygen -t ed25519 -f wordsmith_deploy -N ""    # creates wordsmith_deploy(.pub)
```

Add the **public** half to the instance so the Action can log in:

```sh
ssh ubuntu@<static-ip> 'cat >> ~/.ssh/authorized_keys' < wordsmith_deploy.pub
```

Keep `wordsmith_deploy` (the private key) for step 5. Use this dedicated key,
not your personal one.

## 4. Bootstrap the server (installs Caddy) — once
Copy the setup files up and run the bootstrap:

```sh
scp deploy/setup-server.sh deploy/Caddyfile ubuntu@<static-ip>:/tmp/
ssh ubuntu@<static-ip>
cd /tmp
sudo DEPLOY_DOMAIN=wordsmith.example.com DEPLOY_USER=ubuntu bash setup-server.sh
```

This installs Caddy, creates `/var/www/wordsmith` (writable by `ubuntu`,
readable by Caddy), installs the Caddyfile, and starts the service. Caddy
gets the TLS cert automatically on the first HTTPS request.

## 5. Add the GitHub secrets + variable
In the repo: **Settings → Secrets and variables → Actions**.

**Secrets** (encrypted; I never see these):
| Name | Value |
|---|---|
| `LIGHTSAIL_HOST` | your instance's static IP (or hostname) |
| `LIGHTSAIL_USER` | `ubuntu` (or your deploy user) |
| `LIGHTSAIL_SSH_KEY` | the full contents of the private `wordsmith_deploy` file |

**Variable** (Variables tab):
| Name | Value |
|---|---|
| `DEPLOY_DOMAIN` | `wordsmith.example.com` |

## 6. Deploy
Either push any change to the branch, or run it manually: **Actions →
Deploy to Lightsail → Run workflow**. When it's green, open
`https://wordsmith.example.com` — you should see the app.

## 7. Install on iPhone
Open the URL in **Safari** → Share → **Add to Home Screen**. It launches
standalone and works offline.

---

## Verify
```sh
curl -sI https://wordsmith.example.com/manifest.webmanifest | grep -i content-type
#   content-type: application/manifest+json
curl -sI https://wordsmith.example.com/js/app.js | grep -i content-type
#   content-type: text/javascript
```
In desktop Safari/Chrome DevTools → Application, the service worker should be
**activated** and the app should still load with the network offline.

## Troubleshooting
- **Cert not issued / site not loading:** confirm DNS resolves to the IP and
  ports 80+443 are open (step 2). Check `sudo journalctl -u caddy -e`.
- **Action fails at rsync (permission denied):** the public key isn't in the
  instance's `~/.ssh/authorized_keys` for `LIGHTSAIL_USER`, or the private
  key in `LIGHTSAIL_SSH_KEY` doesn't match. Re-do step 3.
- **Action fails at host key:** the runner pins the host key each run via
  `ssh-keyscan`; if you rebuilt the instance, just re-run the workflow.
- **Old version still showing:** the service worker caches the shell; it
  updates on next launch (the cache is versioned). Hard-refresh once, or on
  iPhone close and reopen the app.
