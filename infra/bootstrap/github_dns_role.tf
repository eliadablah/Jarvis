# Role the deploy jobs use to point the Jarvis names at a server and to get
# HTTPS certificates. Least privilege:
#   - only jobs in my repo's dev/production environments can assume it
#   - it can only change A and TXT records for the Jarvis names (TXT is for
#     the Let's Encrypt _acme-challenge proof), nothing else in the zone
#   - it can only read and write the certificate bucket
# The servers themselves never hold any AWS credentials.

data "aws_route53_zone" "main" {
  name         = var.dns_zone_name
  private_zone = false
}

locals {
  dns_change_names = concat(
    var.jarvis_hostnames,
    [for name in var.jarvis_hostnames : "_acme-challenge.${name}"],
  )
}

data "aws_iam_policy_document" "dns_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for env in var.deploy_environments : "${var.github_oidc_subject_prefix}:environment:${env}"]
    }
  }
}

resource "aws_iam_role" "dns" {
  name                 = "jarvis-github-dns"
  assume_role_policy   = data.aws_iam_policy_document.dns_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "dns_permissions" {
  statement {
    sid       = "ChangeOnlyJarvisRecords"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = [data.aws_route53_zone.main.arn]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      values   = local.dns_change_names
    }

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "route53:ChangeResourceRecordSetsRecordTypes"
      values   = ["A", "TXT"]
    }
  }

  statement {
    sid       = "ReadZone"
    actions   = ["route53:ListResourceRecordSets"]
    resources = [data.aws_route53_zone.main.arn]
  }

  statement {
    sid       = "WaitForChanges"
    actions   = ["route53:GetChange"]
    resources = ["arn:aws:route53:::change/*"]
  }

  statement {
    sid       = "ListCertBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.certs.arn]
  }

  statement {
    sid       = "ReadWriteCerts"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.certs.arn}/*"]
  }
}

resource "aws_iam_role_policy" "dns" {
  name   = "jarvis-dns-and-certs"
  role   = aws_iam_role.dns.id
  policy = data.aws_iam_policy_document.dns_permissions.json
}
