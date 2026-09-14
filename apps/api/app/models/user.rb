# An admin, provisioned just-in-time from verified WorkOS JWT claims on each authenticated
# request. Rails holds no independent copy of WorkOS's membership state to drift out of sync —
# this table exists for foreign keys, display names and audit, not as a source of truth.
class User < ApplicationRecord
  include JitProvisioning
  include LastSeen

  # An AuthKit access token carries no email unless the WorkOS JWT template has been configured to
  # add one, and `email` is NOT NULL, so a first sighting of an admin without one is provisioned
  # with an address at this domain (see .defaults_from). `.invalid` is reserved by RFC 2606
  # precisely so that it can never resolve: the placeholder is obviously a placeholder, and
  # obviously not somewhere a message could be sent. Nothing in this product emails an admin.
  PLACEHOLDER_EMAIL_DOMAIN = "users.workos.invalid".freeze

  has_many :group_admins, dependent: :destroy
  has_many :groups, through: :group_admins
  has_many :sign_ins, dependent: :destroy

  validates :workos_user_id, presence: true, uniqueness: true
  validates :email, presence: true

  # The rows WorkOS could still tell us something about: provisioned from a token that carried
  # neither an email nor a name, and never filled in since. `users:refresh_from_workos` walks exactly
  # this set, and nothing else does.
  #
  # One literal with a bound parameter rather than three chained `or`s: the placeholder is a suffix,
  # so it needs LIKE, and a name of spaces is as absent as a name of nil — WorkOS hands back both
  # for the same empty signup field.
  scope :missing_workos_identity, -> {
    where("email LIKE :placeholder OR name IS NULL OR TRIM(name) = ''",
      placeholder: "%@#{PLACEHOLDER_EMAIL_DOMAIN}")
  }

  # The admin themselves, from claims that WorkOS signed and WorkosAccessToken verified — with no
  # house in sight.
  #
  # It lives here rather than inside GroupAdmin.provision! because there is now a second caller that
  # has no organization to provision beside the user: POST /api/sign_ins records a sign-in from a
  # token whose `org_id` may be missing, which is precisely the funnel step we most need (see
  # Api::SignInsController). Both callers must upsert the user the same way, so they do it through
  # the same method rather than through two that agree today.
  #
  # Idempotent and race-safe: the sign-in callback and the dashboard's first /api/me arrive within
  # milliseconds of each other on a brand new admin, both wanting to create this row.
  def self.provision!(claims)
    user = find_or_provision!({ workos_user_id: claims.workos_user_id }, defaults_from(claims))
    resync(user, claims)
    user
  end

  # The stand-in address for an admin WorkOS named without an email. Public because the super admin
  # console's specs build such a user directly, and because .defaults_from below is private.
  def self.placeholder_email(workos_user_id)
    "#{workos_user_id}@#{PLACEHOLDER_EMAIL_DOMAIN}"
  end

  # An AuthKit access token carries no email and no name — they arrive only if the WorkOS JWT
  # template has been configured to add them. The column is NOT NULL, so a first sighting of an
  # admin without them gets a placeholder that is obviously a placeholder, and obviously not a
  # deliverable address. Nothing in this product emails an admin.
  def self.defaults_from(claims)
    {
      email: claims.email || placeholder_email(claims.workos_user_id),
      name: claims.name
    }
  end
  private_class_method :defaults_from

  # Only what WorkOS owns is written back on later requests, and only when it actually differs —
  # this runs on the authenticated read path, where the steady state must cost no writes at all.
  def self.resync(user, claims)
    user.update!(email: claims.email) if claims.email && claims.email != user.email
    user.update!(name: claims.name) if claims.name && claims.name != user.name
  end
  private_class_method :resync

  # Fill what WorkOS can fill, and nothing else.
  #
  # Two callers, one rule. POST /api/sign_ins passes what the AuthKit session held (the web app has
  # the WorkOS user object in its callback and forwards it); `users:refresh_from_workos` passes what
  # the WorkOS directory answered. Both are idempotent, and a second call with the same identity
  # writes nothing.
  #
  # GAP-FILLING ONLY, and that is the whole design. On the sign-in path this identity arrives in the
  # request BODY, not in the signed token: the token proves who is asking, the body is only their
  # word for what they are called. Because it can write nothing but the caller's own row, and only
  # into a slot that is empty, the worst a lie can do is name a person nothing had named — which is
  # what this exists for. A stored address WorkOS verified is never overwritten by it, and a blank
  # never replaces a fact in either direction.
  #
  # Returns whether anything was written, which is what the task counts.
  def absorb_workos_identity!(identity)
    changes = {}
    changes[:email] = identity.email if identity.email.present? && email_placeholder?
    changes[:name] = identity.name if identity.name.present? && name.blank?
    return false if changes.empty?

    update!(changes)
    true
  end

  # Whether the stored address is the stand-in above rather than something WorkOS actually told us.
  # The super admin console shows "not provided" instead, so an operator is never handed an address
  # that looks deliverable and is not.
  def email_placeholder?
    email.to_s.end_with?("@#{PLACEHOLDER_EMAIL_DOMAIN}")
  end
end
