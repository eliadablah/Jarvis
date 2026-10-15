# Private S3 bucket that keeps the Let's Encrypt certificates for the Jarvis
# names. CI reuses a stored certificate until it's close to expiring, so
# rebuilding the dev server doesn't ask Let's Encrypt for a new one each
# time (Let's Encrypt limits duplicate certificates per week).

resource "aws_s3_bucket" "certs" {
  bucket = "jarvis-certs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "certs" {
  bucket = aws_s3_bucket.certs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "certs" {
  bucket = aws_s3_bucket.certs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "certs_https_only" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.certs.arn,
      "${aws_s3_bucket.certs.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "certs" {
  bucket = aws_s3_bucket.certs.id
  policy = data.aws_iam_policy_document.certs_https_only.json

  depends_on = [aws_s3_bucket_public_access_block.certs]
}
