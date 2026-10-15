#!/usr/bin/env bash
# Points a Jarvis name at a server's Tailscale address and makes sure there's
# a valid HTTPS certificate for it. Runs on the GitHub Actions runner, after
# it has joined the tailnet and assumed the jarvis-github-dns AWS role.
#
# Usage: dns-and-cert.sh <tailscale-hostname> <domain>
#   e.g. dns-and-cert.sh jarvis-dev dev-jarvis.eliadablah.com
#
# Needs CERT_BUCKET and ROUTE53_ZONE_ID, plus the AWS credentials that
# aws-actions/configure-aws-credentials puts in the environment.
# Leaves the certificate in ./certs/ for deploy.sh to ship to the server.
set -euo pipefail

host="$1"
domain="$2"
: "${CERT_BUCKET:?CERT_BUCKET is required}"
: "${ROUTE53_ZONE_ID:?ROUTE53_ZONE_ID is required}"

lego_image="goacme/lego:v4.35.2"
renew_within_days=30

# --- 1. DNS: point the name at the server's private Tailscale address ---
# The address changes whenever dev is rebuilt, so every deploy refreshes it.
ip="$(tailscale ip -4 "$host")"
echo "DNS: $domain -> $ip"
change_batch="$(cat <<JSON
{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{
  "Name":"$domain","Type":"A","TTL":60,"ResourceRecords":[{"Value":"$ip"}]}}]}
JSON
)"
aws route53 change-resource-record-sets \
  --hosted-zone-id "$ROUTE53_ZONE_ID" \
  --change-batch "$change_batch" \
  --query 'ChangeInfo.Status' --output text

# --- 2. Certificate: reuse the stored one unless it's close to expiring ---
mkdir -p certs
chmod 700 certs
s3_prefix="s3://$CERT_BUCKET/$domain"

if aws s3 cp "$s3_prefix/fullchain.pem" certs/fullchain.pem --only-show-errors 2>/dev/null \
  && aws s3 cp "$s3_prefix/key.pem" certs/key.pem --only-show-errors 2>/dev/null \
  && openssl x509 -checkend $((renew_within_days * 86400)) -noout -in certs/fullchain.pem; then
  echo "Certificate: reusing stored certificate for $domain"
else
  # Let's Encrypt checks a TXT record under _acme-challenge.<domain> to
  # confirm I control the name. lego creates and removes that record.
  echo "Certificate: requesting a new one from Let's Encrypt for $domain"
  mkdir -p .lego
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e HOME=/tmp \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
    -e AWS_REGION=us-east-1 \
    -e AWS_HOSTED_ZONE_ID="$ROUTE53_ZONE_ID" \
    -v "$PWD/.lego:/lego" \
    "$lego_image" \
    --accept-tos --path /lego --dns route53 --domains "$domain" run

  cp ".lego/certificates/$domain.crt" certs/fullchain.pem
  cp ".lego/certificates/$domain.key" certs/key.pem
  aws s3 cp certs/fullchain.pem "$s3_prefix/fullchain.pem" --sse AES256 --only-show-errors
  aws s3 cp certs/key.pem "$s3_prefix/key.pem" --sse AES256 --only-show-errors
  rm -rf .lego
fi

chmod 600 certs/key.pem
echo "Certificate: valid until $(openssl x509 -enddate -noout -in certs/fullchain.pem | cut -d= -f2)"
