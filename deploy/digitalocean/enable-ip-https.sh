#!/usr/bin/env bash
set -euo pipefail
address=${1:?public IPv4 address required}
[[ "$address" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo 'Invalid IPv4 address' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv
python3 -m venv /opt/mlgw-certbot
/opt/mlgw-certbot/bin/pip install --quiet 'certbot>=5.4,<7'
/opt/mlgw-certbot/bin/pip freeze > /etc/mlgw/certbot-requirements.txt
install -d -m 0755 /var/lib/mlgw-acme
cat > /etc/caddy/Caddyfile <<EOF
http://${address} {
  handle /.well-known/acme-challenge/* {
    root * /var/lib/mlgw-acme
    file_server
  }
  handle {
    reverse_proxy 127.0.0.1:4173
  }
}
EOF
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
/opt/mlgw-certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --preferred-profile shortlived --webroot --webroot-path /var/lib/mlgw-acme --ip-address "$address" --cert-name mlgw-ip
install -d -o root -g caddy -m 0750 /etc/caddy/tls
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/mlgw-caddy <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
install -o root -g caddy -m 0640 /etc/letsencrypt/live/mlgw-ip/fullchain.pem /etc/caddy/tls/fullchain.pem
install -o root -g caddy -m 0640 /etc/letsencrypt/live/mlgw-ip/privkey.pem /etc/caddy/tls/privkey.pem
systemctl reload caddy
EOF
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/mlgw-caddy
/etc/letsencrypt/renewal-hooks/deploy/mlgw-caddy
cat > /etc/caddy/Caddyfile <<EOF
http://${address} {
  handle /.well-known/acme-challenge/* {
    root * /var/lib/mlgw-acme
    file_server
  }
  handle {
    redir https://${address}{uri} permanent
  }
}
https://${address} {
  tls /etc/caddy/tls/fullchain.pem /etc/caddy/tls/privkey.pem
  encode gzip
  reverse_proxy 127.0.0.1:4173
}
EOF
printf 'PUBLIC_ORIGIN=https://%s\n' "$address" > /etc/mlgw/dashboard.env
caddy validate --config /etc/caddy/Caddyfile
systemctl restart mlgw-dashboard
systemctl reload caddy
cat > /etc/systemd/system/mlgw-certbot.service <<'EOF'
[Unit]
Description=Renew MLGW public IP HTTPS certificate
After=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/mlgw-certbot/bin/certbot renew --quiet
EOF
cat > /etc/systemd/system/mlgw-certbot.timer <<'EOF'
[Unit]
Description=Check MLGW certificate renewal twice a day
[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=3600
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now mlgw-certbot.timer
curl --fail --show-error --silent --retry 15 --retry-connrefused --retry-delay 1 "https://${address}/api/health"
