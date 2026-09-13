# Who counts as a super admin, for the duration of one example.
#
# The allowlist is resolved once at boot from SUPER_ADMIN_WORKOS_USER_IDS (see
# config/initializers/super_admin.rb), so a spec cannot set an env var and expect it to matter.
# It swaps the resolved set instead, and the around hook puts the booted one back — without it,
# one example's operator would still be a super admin in every example after it, and the specs
# that assert "unset means nobody" would pass or fail on file order.
module SuperAdminAllowlistHelper
  # No argument means an empty allowlist, which is what an unset variable resolves to. Specs that
  # test "nobody is allowlisted" call it explicitly rather than trusting the environment the suite
  # happened to boot in — a developer with the variable set in their own .env must not see a
  # different result from CI.
  def allowlist_super_admins(*workos_user_ids)
    Rails.application.config.x.super_admin.allowlist = workos_user_ids.flatten.to_set.freeze
  end
end

RSpec.configure do |config|
  config.include SuperAdminAllowlistHelper

  # A before/after pair rather than an `around`, so this file does not appear in the backtrace of
  # every failure in the suite.
  config.before { @booted_super_admin_allowlist = Rails.application.config.x.super_admin.allowlist }
  config.after { Rails.application.config.x.super_admin.allowlist = @booted_super_admin_allowlist }
end
