# Run using bin/ci. This is the single definition of "does it pass" — GitHub Actions
# invokes bin/ci rather than listing its own steps, so `bin/ci` locally is the same gate
# your PR will hit. Add a check here, not in .github/workflows/ci.yml.
#
# Rails generates the security steps below but nothing calls them by default. They are
# wired up on purpose: this app is about to grow JWT verification, tenancy scoping, a
# Twilio webhook and magic-link auth, and every one of those wants SAST and CVE gating
# on the PR that introduces it.

CI.run do
  step "Setup", "bin/setup --skip-server"

  step "Style: Ruby", "bin/rubocop"

  step "Security: Gem audit", "bin/bundler-audit"
  step "Security: Brakeman code analysis", "bin/brakeman --quiet --no-pager --exit-on-warn --exit-on-error"

  step "Tests: Ruby", "bundle exec rspec"

  # Optional: set a green GitHub commit status to unblock PR merge.
  # Requires the `gh` CLI and `gh extension install basecamp/gh-signoff`.
  # if success?
  #   step "Signoff: All systems go. Ready for merge and deploy.", "gh signoff"
  # else
  #   failure "Signoff: CI failed. Do not merge or deploy.", "Fix the issues and try again."
  # end
end
