#!/usr/bin/env bash
# Run this in OCI CLOUD SHELL (the >_ icon at the top right of the Oracle
# console — already signed in, no API keys needed). It keeps trying to
# launch a free Ampere A1 instance until Oracle has capacity, cycling
# through the fault domains each attempt, then prints the public IP.
#
#   bash oci-grab-a1.sh
#
# Make sure the console's region selector (top bar) is set to the region you
# want (Johannesburg) BEFORE starting. Leave the Cloud Shell tab open.
set -uo pipefail

# --- settings (your tenancy's A1 allowance is 2 OCPU / 12 GB) -----------------
NAME="alnajoum-app"
OCPUS=2
MEMORY_GB=12
BOOT_GB=100
RETRY_SECONDS=60
SSH_PUBKEY='ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDRE4prRLw4sKzKMeYWl9Tk9+8zEnH5B3lTZrHVCyBx0Gp/c+PHIiXLBowckuC++6UBgMB04C5ZXC33tJPXHd8+pFZ1ZcK4PBw2noY+hsVS6opK7citV10PEgu74yxJfJVJlWzyozO2ybM5AXOcBcSd1voC/q5BKnzjuipiRwfmcpEP1uIx7LcWufcn5g5xfVkuKa+Kv7/P6cteRMgTfYMn8rWJXl+/sXxKcySfDAjLwdRq3XJR7XGKXCLNRk2thx7jKmJRjQEUmJhG2kU9ho+Xj/Z8/5+wL+3pMqQiXFaPQ17hsk11fPJj1K6ljkCZC7RCWdF7ldOz4G8sKdlk/cid ssh-key-2026-08-29'
# ------------------------------------------------------------------------------

clean() { local v="${1:-}"; [ "$v" = "null" ] && v=""; echo "$v"; }

C="${OCI_TENANCY:-}"
if [ -z "$C" ]; then
  echo "OCI_TENANCY is not set — run this inside OCI Cloud Shell." >&2
  exit 1
fi
echo "Region: ${OCI_REGION:-unknown}"

echo "==> Looking up availability domain"
AD="$(clean "$(oci iam availability-domain list -c "$C" --query 'data[0].name' --raw-output)")"
[ -n "$AD" ] || { echo "Could not read the availability domain." >&2; exit 1; }
echo "    $AD"

echo "==> Checking you don't already have this instance"
EXISTING="$(clean "$(oci compute instance list -c "$C" --display-name "$NAME" \
  --query 'data[?"lifecycle-state"!=`TERMINATED`] | [0].id' --raw-output)")"
if [ -n "$EXISTING" ]; then
  echo "An instance named $NAME already exists ($EXISTING). Nothing to do."
  exit 0
fi

echo "==> Finding the newest Ubuntu 24.04 ARM image"
IMG="$(clean "$(oci compute image list -c "$C" \
  --operating-system "Canonical Ubuntu" --operating-system-version "24.04" \
  --shape VM.Standard.A1.Flex --sort-by TIMECREATED --sort-order DESC \
  --query 'data[0].id' --raw-output)")"
[ -n "$IMG" ] || { echo "No Ubuntu 24.04 ARM image found in this region." >&2; exit 1; }
echo "    $IMG"

echo "==> Network (created once, reused on re-runs)"
VCN="$(clean "$(oci network vcn list -c "$C" --display-name alnajoum-vcn \
  --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output)")"
if [ -z "$VCN" ]; then
  VCN="$(oci network vcn create -c "$C" --cidr-block 10.0.0.0/16 \
    --display-name alnajoum-vcn --dns-label alnajoumvcn \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output)"
  IGW="$(oci network internet-gateway create -c "$C" --vcn-id "$VCN" \
    --is-enabled true --display-name alnajoum-igw \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output)"
  RT="$(oci network vcn get --vcn-id "$VCN" --query 'data."default-route-table-id"' --raw-output)"
  oci network route-table update --rt-id "$RT" --force --route-rules \
    "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$IGW\"}]" >/dev/null
  SL="$(oci network vcn get --vcn-id "$VCN" --query 'data."default-security-list-id"' --raw-output)"
  oci network security-list update --security-list-id "$SL" --force \
    --egress-security-rules '[{"destination":"0.0.0.0/0","protocol":"all","isStateless":false}]' \
    --ingress-security-rules '[
      {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},
      {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":80,"max":80}}},
      {"source":"0.0.0.0/0","protocol":"6","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":443,"max":443}}}
    ]' >/dev/null
fi
SUBNET="$(clean "$(oci network subnet list -c "$C" --vcn-id "$VCN" --display-name alnajoum-subnet \
  --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output)")"
if [ -z "$SUBNET" ]; then
  SUBNET="$(oci network subnet create -c "$C" --vcn-id "$VCN" --cidr-block 10.0.0.0/24 \
    --display-name alnajoum-subnet --dns-label alnajoumsub \
    --wait-for-state AVAILABLE --query 'data.id' --raw-output)"
fi
echo "    subnet $SUBNET (ports 22, 80, 443 open)"

KEYFILE="$(mktemp)"
printf '%s\n' "$SSH_PUBKEY" > "$KEYFILE"

echo "==> Trying to launch ${OCPUS} OCPU / ${MEMORY_GB} GB A1 — retrying every ${RETRY_SECONDS}s until Oracle has capacity"
ATTEMPT=0
while true; do
  for FD in FAULT-DOMAIN-1 FAULT-DOMAIN-2 FAULT-DOMAIN-3; do
    ATTEMPT=$((ATTEMPT + 1))
    printf '[%s] attempt %d (%s) ... ' "$(date '+%H:%M:%S')" "$ATTEMPT" "$FD"
    OUT="$(oci compute instance launch \
      --availability-domain "$AD" --fault-domain "$FD" -c "$C" \
      --shape VM.Standard.A1.Flex \
      --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEMORY_GB}" \
      --image-id "$IMG" --subnet-id "$SUBNET" --assign-public-ip true \
      --display-name "$NAME" --boot-volume-size-in-gbs "$BOOT_GB" \
      --ssh-authorized-keys-file "$KEYFILE" 2>&1)"

    if echo "$OUT" | grep -q '"lifecycle-state"'; then
      echo "LAUNCHED!"
      INSTANCE_ID="$(echo "$OUT" | grep -m1 '"id"' | sed 's/.*"\(ocid1[^"]*\)".*/\1/')"
      echo "==> Waiting for it to be RUNNING"
      oci compute instance get --instance-id "$INSTANCE_ID" \
        --wait-for-state RUNNING >/dev/null
      IP="$(oci compute instance list-vnics --instance-id "$INSTANCE_ID" \
        --query 'data[0]."public-ip"' --raw-output)"
      echo
      echo "=============================================="
      echo " Instance is running.  Public IP:  $IP"
      echo " Send this IP to Claude to finish the setup."
      echo "=============================================="
      exit 0
    elif echo "$OUT" | grep -qiE 'out of host capacity|OutOfHostCapacity|out of capacity'; then
      echo "no capacity"
    elif echo "$OUT" | grep -qiE 'TooManyRequests|429'; then
      echo "rate limited, backing off"
      sleep 120
    else
      echo "UNEXPECTED ERROR — stopping so you can read it:"
      echo "$OUT"
      exit 1
    fi
  done
  sleep "$RETRY_SECONDS"
done
