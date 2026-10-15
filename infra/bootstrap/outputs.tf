# Values the other stacks and the GitHub workflows need. None are secret:
# role ARNs only work from my repo, and the bucket is private.

output "state_bucket" {
  description = "S3 bucket for Terraform state (use in backend config)."
  value       = aws_s3_bucket.state.bucket
}

output "aws_region" {
  description = "Region everything lives in."
  value       = var.aws_region
}

output "plan_role_arn" {
  description = "Role GitHub Actions assumes for terraform plan."
  value       = aws_iam_role.plan.arn
}

output "apply_role_arn" {
  description = "Role GitHub Actions assumes for terraform apply (production only)."
  value       = aws_iam_role.apply.arn
}
