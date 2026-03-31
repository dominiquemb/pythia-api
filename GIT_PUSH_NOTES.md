# Git Push Notes (Non-Sensitive)

This environment requires explicit permission to access the network for `git push`.

## What Worked
Running `git push` with network access enabled (outside the sandbox). In this setup, that means approving an escalated `git push` run.

## Command
```bash
git push
```

## SSH Key
On this machine, GitHub operations should use the dedicated key at `/home/ubuntu/.ssh/github_key`.

Switch the repo to SSH first:
```bash
git -C /home/ubuntu/conejoplata-home/astrology-api remote set-url origin git@github.com:dominiquemb/pythia-api.git
```

Configure the repo with:
```bash
git -C /home/ubuntu/conejoplata-home/astrology-api config core.sshCommand "ssh -i /home/ubuntu/.ssh/github_key -o IdentitiesOnly=yes"
```

Verify auth with:
```bash
ssh -i /home/ubuntu/.ssh/github_key -o IdentitiesOnly=yes -T git@github.com
```

## If Push Fails
Common failure when network access is blocked:
- `Could not resolve host: github.com`

Fix:
- Re-run `git push` with network access approved for the command.
