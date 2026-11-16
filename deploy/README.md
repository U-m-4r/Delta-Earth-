# Deploying Delta Earth

- **Site:** https://deltaearth.earth on Firebase Hosting (static build of `Frontend/`)
- **API:** https://api.deltaearth.earth on a Google Compute Engine VM (FastAPI behind Caddy, which handles HTTPS)

## 1. Backend VM (once)

1. In Google Cloud, create a VM: **e2-small**, **Ubuntu 24.04 LTS**, 30 GB disk, and tick **Allow HTTP** and **Allow HTTPS** traffic.
2. Under *VPC network → IP addresses*, make the VM's external IP **static**.
3. In GoDaddy DNS for `deltaearth.earth`, add an **A** record: name `api`, value = the VM's static IP.
4. SSH into the VM (the *SSH* button in the console), then:
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/U-m-4r/Delta-Earth-/main/deploy/setup-vm.sh
   sudo bash setup-vm.sh
   sudo nano /opt/delta-earth/Backend/.env      # paste the Earthdata token after EDL_TOKEN=
   sudo systemctl restart delta-earth
   curl https://api.deltaearth.earth/api/stories   # should print the story list
   ```
   HTTPS starts working once the `api` DNS record has propagated (usually a few minutes).

**Update the backend later:** SSH in and run `sudo bash setup-vm.sh` again. It pulls `main`, reinstalls and restarts.
**Logs:** `sudo journalctl -u delta-earth -f`

## 2. Frontend (Firebase Hosting)

```bash
npm install -g firebase-tools
firebase login
cd Frontend
firebase use --add            # pick the Google Cloud project
npm run build                 # uses .env.production → api.deltaearth.earth
firebase deploy --only hosting
```

Then, in the Firebase console, open *Hosting → Add custom domain*, add `deltaearth.earth` (and `www.deltaearth.earth`), and copy the DNS records it shows into GoDaddy. Firebase issues the HTTPS certificate itself.

**Update the site later:** `npm run build && firebase deploy --only hosting`

## Notes

- The Earthdata token lives only in `/opt/delta-earth/Backend/.env` on the VM. Never commit it.
- Every visitor who analyses their own area downloads data under that token's Earthdata account.
- Downloaded data is kept in `/var/lib/delta-earth` on the VM's disk.
