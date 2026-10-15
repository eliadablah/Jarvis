# Bootstrap

One-time AWS setup that everything else depends on. I apply this by hand from my PC, not from GitHub Actions.

## What it creates

| Thing | Why |
|---|---|
| S3 bucket `jarvis-tfstate-<account id>` | Holds Terraform's state for the other stacks. Private, encrypted, versioned, HTTPS-only. |
| IAM role `jarvis-github-plan` | GitHub Actions uses it to preview changes. Read-only AWS access. Any branch or PR in my repo. |
| IAM role `jarvis-github-apply` | GitHub Actions uses it to change Lightsail. Only jobs in the `production` environment, which waits for my approval. |

It reuses the GitHub OIDC provider that already exists in my AWS account (an account can only have one), so my other projects that use it keep working.

The $15 monthly budget alert was set up by hand in the AWS console.

## Apply it

From this folder:

```powershell
terraform init
terraform plan -out=bootstrap.tfplan
terraform apply bootstrap.tfplan
terraform output
```

The outputs (bucket name, region, role ARNs) go into the GitHub repo's Actions variables in the CI/CD phase. None of them are secret.

## State

This stack keeps its state locally (it creates the bucket the other stacks use). The local state file is gitignored.
