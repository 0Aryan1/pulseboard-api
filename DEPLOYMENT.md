# PulseBoard — Deployment

How PulseBoard runs in production, and how to update or fix it. No secrets in this file.

## Overview

| Part | Where it runs | Notes |
|---|---|---|
| Frontend (`web/`) | Vercel | Root dir `web`. `web/vercel.json` rewrites all paths to `index.html` so routes work on refresh |
| API (`src/server.js`) | AWS EC2 t3.micro, Ubuntu, `ap-southeast-2` (Sydney) | Run by PM2 as `api` |
| Worker (`src/worker.js`) | Same EC2 instance | Run by PM2 as `worker` |
| HTTPS / reverse proxy | Caddy on the same instance | Proxies `https://pulseboard-aryan.duckdns.org` to `localhost:3000`, gets certificates automatically |
| Database | Neon Postgres (Sydney, free) | Connection string in server `.env` |
| Redis / queue | Redis Cloud free (30 MB) | Cache and BullMQ queue |
| Hostname | DuckDNS `pulseboard-aryan.duckdns.org` | Points to the Elastic IP |
| Fixed IP | AWS Elastic IP `16.178.0.161` | Must stay attached to the instance |

Frontend: https://pulseboard-api.vercel.app
API health: https://pulseboard-aryan.duckdns.org/health

## Why it is built this way

- **Vercel is HTTPS**, and browsers block an HTTPS page from calling an HTTP API. The API therefore needs HTTPS too, which needs a hostname. Caddy gets the certificate for the DuckDNS name.
- **No Docker.** PM2 runs the Node processes directly. It restarts them if they crash and on reboot.
- **API and worker both start from `~/pulseboard-api`.** Uploads are saved to the relative `uploads/` folder, so both must share the same working directory.
- **tsx is a devDependency**, so the server uses a full `npm ci` and runs `npx tsx ...`.

## Environment variables

Set in `~/pulseboard-api/.env` on the server:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | Neon connection string (keep `?sslmode=require`) |
| `REDIS_URL` | `redis://default:<password>@<host>:<port>` from Redis Cloud |
| `JWT_SECRET` | Random secret, made with `openssl rand -base64 32` |
| `CORS_ORIGIN` | `https://pulseboard-api.vercel.app` (no trailing `/`) |

Set in Vercel (Project → Settings → Environment Variables):

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://pulseboard-aryan.duckdns.org/api/v1` |

After changing a Vercel variable, redeploy. After changing the server `.env`, run `pm2 restart all --update-env`.

## Caddy config

`/etc/caddy/Caddyfile`:

```
pulseboard-aryan.duckdns.org {
    reverse_proxy localhost:3000
}
```

Apply changes with `sudo systemctl restart caddy`. WebSockets (Socket.IO) work through it without extra settings.

## Updating the app

Frontend: push to `main`. Vercel redeploys automatically.

Backend: push to `main`. GitHub Actions runs the tests and then deploys (see [Automatic deploys](#automatic-deploys-github-actions--ssm)). Watch it in the repo's **Actions** tab.

If the change includes a new file in `migrations/`, the deploy stops before touching the server. Apply that SQL to Neon first (for example with `psql "$DATABASE_URL" -f migrations/NNN_name.sql`), then open **Actions → Test and deploy → Run workflow**, tick "I already applied this deploy's new migrations", and run it on `main`. Migrations are raw SQL and applied by hand.

To deploy by hand instead (SSH in):

```bash
cd ~/pulseboard-api
git fetch origin
bash scripts/deploy.sh origin/main        # add "true" as a second argument if migrations are applied
```

## Automatic deploys (GitHub Actions + SSM)

`.github/workflows/deploy.yml` runs on every push to `main`:

1. **test**: a fresh GitHub runner starts throwaway Postgres 16 and Redis 7, applies `migrations/*.sql`, and runs `npm test`. Pull requests run this job too, but never deploy.
2. **deploy** (only if the tests pass): the job signs in to AWS with the `pulseboard-github-deploy` IAM user's key and sends an SSM Run Command with the `PulseboardDeploy` document. The SSM agent on the server runs `scripts/deploy.sh <commit>` as `ubuntu`. The job waits, prints the script's output, and goes red if it failed.

`scripts/deploy.sh` does: `git fetch` → stop if new migrations (unless allowed) → `git reset --hard <commit>` → `npm ci` only if `package-lock.json` changed → `npx prisma generate` → `pm2 restart api worker` → check `/health` for about 30s. If `/health` fails, it goes back to the previous commit and restarts again.

Port 22 is not used by the deploy.

**Why a stored key and not OIDC:** the account is on the AWS Free plan, whose organization policy denies `iam:CreateOpenIDConnectProvider`. So GitHub uses an IAM user key instead, locked down so a leak does little harm: the key may only run the `PulseboardDeploy` document (`scripts/ssm-deploy-document.yaml`) on this one instance, and that document accepts nothing but a 40-character commit ID. If the account moves to a paid plan, switching to OIDC removes the stored key.

### One-time AWS setup

Run the `aws` commands in **CloudShell** (Sydney region). Run `export AWS_PAGER=""` first so long output doesn't open a pager.

**A. Let the server talk to SSM**

```bash
aws iam create-role --role-name pulseboard-ec2-ssm --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name pulseboard-ec2-ssm \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam create-instance-profile --instance-profile-name pulseboard-ec2-ssm
aws iam add-role-to-instance-profile --instance-profile-name pulseboard-ec2-ssm --role-name pulseboard-ec2-ssm
aws ec2 associate-iam-instance-profile --instance-id <INSTANCE_ID> --iam-instance-profile Name=pulseboard-ec2-ssm
```

Then on the server: `sudo snap restart amazon-ssm-agent`. Check with `aws ssm describe-instance-information --query "InstanceInformationList[].[InstanceId,PingStatus]" --output text`. It should say `Online`.

**B. Create the deploy document**

Copy `scripts/ssm-deploy-document.yaml` into CloudShell (paste it with `cat > ssm-deploy-document.yaml`), then:

```bash
aws ssm create-document --name PulseboardDeploy --document-type Command \
  --document-format YAML --content file://ssm-deploy-document.yaml
```

After changing the file later, use `aws ssm update-document --name PulseboardDeploy --document-format YAML --content file://ssm-deploy-document.yaml --document-version '$LATEST'`, then `aws ssm update-document-default-version --name PulseboardDeploy --document-version <new version>`.

**C. Create the deploy user and its key**

```bash
aws iam create-user --user-name pulseboard-github-deploy
aws iam put-user-policy --user-name pulseboard-github-deploy --policy-name deploy-via-ssm --policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:ap-southeast-2:<ACCOUNT_ID>:instance/<INSTANCE_ID>",
        "arn:aws:ssm:ap-southeast-2:<ACCOUNT_ID>:document/PulseboardDeploy"
      ]
    },
    { "Effect": "Allow", "Action": "ssm:GetCommandInvocation", "Resource": "*" }
  ]
}'
aws iam create-access-key --user-name pulseboard-github-deploy
```

`GetCommandInvocation` does not support resource limits, so it uses `*`. It can only read command results. The last command prints the key **once**. Put it straight into GitHub, and don't save it anywhere else.

**D. Give the workflow the key and the instance**

GitHub repo → Settings → Secrets and variables → Actions:

| Tab | Name | Value |
|---|---|---|
| Secrets | `AWS_ACCESS_KEY_ID` | `AccessKeyId` from step C |
| Secrets | `AWS_SECRET_ACCESS_KEY` | `SecretAccessKey` from step C |
| Variables | `EC2_INSTANCE_ID` | `i-...` |

**Rotating the key** (for example once a year, or right away if it may have leaked): `aws iam create-access-key --user-name pulseboard-github-deploy`, update both GitHub secrets, then delete the old one with `aws iam delete-access-key --user-name pulseboard-github-deploy --access-key-id <OLD_ID>`. A user can have at most two keys.

## First-time server setup (summary)

1. Launch EC2 t3.micro (Ubuntu), 20 GiB disk, key pair `pulseboard.pem`. Set the credit specification to **Standard**.
2. Security group inbound: SSH 22 from your IP range, HTTP 80 and HTTPS 443 from anywhere.
3. Allocate an Elastic IP and attach it to the instance.
4. Create the DuckDNS subdomain pointing to the Elastic IP.
5. On the server: add swap (the instance has under 1 GB of RAM), install Node 20, PM2 and Caddy.
6. `git clone`, `npm ci`, `DATABASE_URL=postgresql://x:x@localhost/x npx prisma generate` (the fake URL is fine, generate never connects), create `.env`.
7. Start both processes from `~/pulseboard-api`:
   ```bash
   pm2 start "npx tsx src/server.js" --name api
   pm2 start "npx tsx src/worker.js" --name worker
   pm2 save
   pm2 startup   # run the sudo line it prints, then pm2 save again
   ```
8. Write the Caddyfile above and restart Caddy.
9. Deploy `web/` on Vercel with the variable above, then set `CORS_ORIGIN` on the server.

## Everyday commands (on the server)

```bash
pm2 status                          # are api and worker online?
pm2 logs api --lines 50 --nostream  # recent API logs
pm2 logs worker --lines 50 --nostream
pm2 restart all --update-env        # after editing .env
curl localhost:3000/health          # API + Postgres + Redis check
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 30 --no-pager
```

SSH in:

```bash
ssh -i ~/Downloads/pulseboard.pem ubuntu@16.178.0.161
```

## Uploads

Files are saved by multer to `~/pulseboard-api/uploads` on the server disk. The worker checks that the file exists and marks the attachment `ready`. Downloads go through the API. The files exist only on this disk, so back them up:

```bash
scp -i ~/Downloads/pulseboard.pem -r ubuntu@16.178.0.161:~/pulseboard-api/uploads ~/pulseboard-uploads-backup
```

Planned: move to object storage (S3 or Cloudflare R2). That means changing `src/middleware/upload.middleware.js`, `src/controllers/attachments.controller.js` and `src/worker.js`, and storing the object key in `file_url`.

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| SSH hangs or "Operation timed out" | Your home IP changed and the security group SSH rule no longer matches. Edit the rule (use `103.83.146.0/24` or "My IP"). |
| Browser shows a CORS error | `CORS_ORIGIN` does not match the Vercel URL exactly (no trailing `/`). Fix `.env`, then `pm2 restart all --update-env`. |
| Vercel page shows 404 on refresh | `web/vercel.json` missing from the deploy. |
| `/health` returns 503 or a failed check | Run `pm2 logs api`. Check `DATABASE_URL` and `REDIS_URL`. Neon may be waking from sleep, so retry. |
| Uploads stay "processing" | Worker is not running. `pm2 status`, then `pm2 logs worker`. |
| `npm ci` shows "Killed" | Out of memory. Check swap with `free -h`. |
| Deploy job: "not authorized to perform: ssm:SendCommand" | The user policy's instance ID, account ID or document name doesn't match. Check `aws iam get-user-policy --user-name pulseboard-github-deploy --policy-name deploy-via-ssm`. |
| Deploy job: "InvalidParameters" | The `PulseboardDeploy` document's parameters don't match what the workflow sends (`commitSha`, `allowMigrations`). |
| Deploy job: "InvalidInstanceId" | The SSM agent is not online. Check the instance has the `pulseboard-ec2-ssm` role, then `sudo snap restart amazon-ssm-agent` and look in Fleet Manager. |
| Deploy job stops with "this deploy adds migrations" | Apply the new SQL to Neon, then run the workflow by hand with "migrations applied" ticked. |
| Deploy job says it rolled back | The new code failed `/health`. The old version is running. Read the `pm2 logs` lines printed in the job output. |
| Red WebSocket error in the console | Usually a one-off during login, or a browser shield. Socket.IO falls back to polling. Check Network → WS for a `101`. |
| Redis log says "Eviction policy is volatile-lru" | Redis Cloud free plan setting. BullMQ prefers `noeviction`. Safe to ignore at this size. |

## Cost and safety checklist

- Keep the Elastic IP attached. An unattached one is billed.
- Set a billing budget alert (about $1) and enable MFA on the AWS account.
- Keep the instance credit specification on **Standard**, not Unlimited.
- Neon free tier sleeps when idle, so the first request after a pause is slow.
- Redis Cloud free limits: 30 MB, 30 connections, 100 ops/sec.
- Check the AWS Free Tier page in Billing for how long your account's free usage lasts.
