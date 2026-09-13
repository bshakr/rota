# Who is allowed to see every house in the database.
#
# The grant is one environment variable, SUPER_ADMIN_WORKOS_USER_IDS, holding WorkOS user ids (the
# `sub` claim, which every token already carries). Nothing in the app can write it: granting god
# mode is a deploy, never a click, and there is no row, role or flag an attacker could flip to add
# themselves. Unset or empty means nobody — in production, and in development too — so the deploy
# that ships this area is inert until somebody sets the variable.
#
# Resolved once, here, rather than read from ENV per request: a value the app re-reads is a value
# that can change under it, and this one is the whole of the authorization decision.
#
# The rules live in the SuperAdminAllowlist module so they can be tested without booting a
# production environment, the same shape as SmsBoot in config/initializers/sms.rb. It is a
# top-level constant and deliberately NOT `SuperAdmin`: that name belongs to the autoloader (see
# app/controllers/super_admin/), and a module defined here and reopened there would lose these
# methods the first time the development reloader swept the namespace.
module SuperAdminAllowlist
  # Nobody. What an unset variable resolves to, and what `allows?` falls back to if it is ever
  # asked before boot resolved anything: the only safe reading of "there is no list".
  NOBODY = Set.new.freeze

  module_function

  # Commas are the documented separator; whitespace and newlines are split on too, because a value
  # pasted into a deploy platform's web form arrives with both, and an id carrying a stray space is
  # an operator who cannot get in and cannot see why.
  def parse(raw)
    raw.to_s.split(/[,\s]+/).reject(&:empty?).to_set.freeze
  end

  def ids
    Rails.application.config.x.super_admin.allowlist || NOBODY
  end

  # The authorization decision, in one place. A blank subject can never match, whatever is in the
  # list: `ids` cannot contain an empty string, but a rule this small must fail closed on its own
  # terms rather than by relying on the parser two methods up.
  def allows?(workos_user_id)
    workos_user_id.present? && ids.include?(workos_user_id)
  end
end

Rails.application.configure do
  config.x.super_admin.allowlist = SuperAdminAllowlist.parse(ENV["SUPER_ADMIN_WORKOS_USER_IDS"])
end
