#!/usr/bin/env bash
# Creates the whole AWS side of the deployment in one go: a firewall (security group), an SSH key, one Ubuntu 24.04
# server, and a fixed public address (Elastic IP). The server installs and starts the site by itself on first boot,
# using deploy/bootstrap-new-server.sh from the GitHub repository.
#
# Run it on your own computer (Git Bash), with the AWS CLI configured:
#   AWS_PROFILE=alnajoum DOMAIN=alnajoumtravelagency.com ADMIN_EMAIL=you@example.com bash deploy/aws-launch.sh
#
# It prints what it is going to create and what it costs, and does nothing until you re-run it with CONFIRM=yes.
# STATUS: written against AWS's documented CLI but NOT yet run - the account it was prepared for blocks EC2 with an
# organisation rule (see DEPLOYMENT-AWS.md, "Before you start"). Read the output of the first (dry) run carefully.
set -euo pipefail

: "${AWS_PROFILE:?set AWS_PROFILE}"
: "${DOMAIN:?set DOMAIN, e.g. alnajoumtravelagency.com}"
: "${ADMIN_EMAIL:?set ADMIN_EMAIL (the first administrator's login)}"
REGION="${AWS_REGION:-eu-west-1}"
TYPE="${INSTANCE_TYPE:-t3.small}"       # 2 GB. t3.micro (1 GB) is free-tier eligible but too small to build the images
DISK_GB="${DISK_GB:-30}"
NAME="${NAME:-alnajoum-erp}"
REPO_URL="${REPO_URL:-https://github.com/saiflg/alnajoum-erp.git}"
export AWS_PAGER=""
aws() { command aws --region "$REGION" "$@"; }

echo "Account : $(aws sts get-caller-identity --query Arn --output text)"
echo "Region  : $REGION"
echo "Server  : $TYPE, ${DISK_GB} GB disk, Ubuntu 24.04, 1 fixed IP, firewall open on 22/80/443"
echo "Cost    : roughly \$17/month for t3.small + \$3 disk + \$3.6 for the fixed IP (billed hourly; free-tier credits may cover it)"
echo "Domain  : $DOMAIN (you add one DNS record at Cloudflare afterwards)"
if [ "${CONFIRM:-no}" != "yes" ]; then
  echo; echo "Nothing has been created. Re-run with CONFIRM=yes to create it."; exit 0
fi

AMI="$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)"
VPC="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
[ "$VPC" != "None" ] || { echo "No default VPC in $REGION; create one first (aws ec2 create-default-vpc)."; exit 1; }

echo "==> Firewall"
SG="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NAME" Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)"
if [ "$SG" = "None" ]; then
  SG="$(aws ec2 create-security-group --group-name "$NAME" --description "Alnajoum ERP web + ssh" --vpc-id "$VPC" --query GroupId --output text)"
  for p in 22 80 443; do aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port "$p" --cidr 0.0.0.0/0 >/dev/null; done
fi

echo "==> SSH key (saved to ~/.ssh/$NAME.pem, never uploaded anywhere else)"
if ! aws ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1; then
  mkdir -p ~/.ssh
  aws ec2 create-key-pair --key-name "$NAME" --query KeyMaterial --output text > ~/.ssh/"$NAME".pem
  chmod 600 ~/.ssh/"$NAME".pem
fi

# Runs as root on first boot. Adds swap (the images build in memory), then the repository's own bootstrap script.
USERDATA="$(mktemp)"
cat > "$USERDATA" <<EOF
#!/bin/bash
set -eux
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
su - ubuntu -c "curl -fsSL https://raw.githubusercontent.com/saiflg/alnajoum-erp/master/deploy/bootstrap-new-server.sh -o /home/ubuntu/bootstrap.sh && DOMAIN='$DOMAIN' ADMIN_EMAIL='$ADMIN_EMAIL' REPO_URL='$REPO_URL' bash /home/ubuntu/bootstrap.sh > /home/ubuntu/bootstrap.log 2>&1"
EOF

echo "==> Server"
ID="$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TYPE" --key-name "$NAME" --security-group-ids "$SG" \
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$DISK_GB,VolumeType=gp3}" \
  --metadata-options HttpTokens=required --user-data "file://$USERDATA" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" --query 'Instances[0].InstanceId' --output text)"
rm -f "$USERDATA"
aws ec2 wait instance-running --instance-ids "$ID"

echo "==> Fixed public IP"
ALLOC="$(aws ec2 allocate-address --domain vpc --query AllocationId --output text)"
aws ec2 associate-address --instance-id "$ID" --allocation-id "$ALLOC" >/dev/null
IP="$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)"

cat <<DONE

Server created: $ID  ($IP)
 1. At Cloudflare, add a DNS record:  Type A, Name @ (and another for www), Content $IP, Proxy status: DNS only (grey cloud).
 2. The site installs itself; it takes about 10-15 minutes. Follow it with:
      ssh -i ~/.ssh/$NAME.pem ubuntu@$IP 'tail -f ~/bootstrap.log'
 3. When it finishes, open https://$DOMAIN . The first administrator's one-time password is in ~/alnajoum-erp/.env.prod on the server
    (BOOTSTRAP_ADMIN_PASSWORD) - change it at first login, then remove that line.
DONE
